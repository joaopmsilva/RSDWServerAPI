#include "kills.h"
#include "dom_engine.h"
#include "reflection.h"
#include "../events/event_log.h"
#include "../utils/logger.h"
#include "../utils/memory.h"

#include <chrono>
#include <deque>
#include <unordered_map>
#include <unordered_set>
#include <utility>

namespace DomKills {

using namespace DomEngine;

namespace {

using Clock = std::chrono::steady_clock;

std::string g_Status = "waiting for a player";
// The same creature is only counted once.
std::deque<std::pair<uintptr_t, Clock::time_point>> g_Recent;
// Creature class -> whether it's a boss, read once each.
std::unordered_map<uintptr_t, bool> g_Bosses;

// Damage components whose FatalDamageInfo is set (the owner is dead, with
// KilledBy saying who did it). Kept between scans so each death counts once;
// the first scan only takes note of the dead already lying around.
std::unordered_set<uintptr_t> g_DeadSeen;
bool g_FirstScan = true;
std::unordered_map<uintptr_t, bool> g_DamageClasses; // class -> is a DamageComponent
bool g_FirstKillLogged = false;

bool CountedAlready(uintptr_t killed) {
    auto now = Clock::now();
    while (!g_Recent.empty() && now - g_Recent.front().second > std::chrono::seconds(10)) g_Recent.pop_front();
    for (const auto& entry : g_Recent) {
        if (entry.first == killed) return true;
    }
    g_Recent.emplace_back(killed, now);
    return false;
}

// Whether the instigator is this player: their controller, their character,
// or something either of them owns (a projectile, a summoned spell).
bool IsPlayers(uintptr_t instigator, uintptr_t controller, uintptr_t pawn) {
    for (uintptr_t actor = instigator, depth = 0; actor && depth < 4; depth++) {
        if (actor == controller || actor == pawn) return true;
        actor = Mem::ReadPtr(actor + Offsets::Actor_Owner);
    }
    return false;
}

// The creature's class name, with " boss" after it for a boss.
std::string CreatureClass(uintptr_t creature) {
    Engine* engine = g_Engine;
    uintptr_t cls = Mem::ReadPtr(creature + Offsets::UObject_Class);
    auto known = g_Bosses.find(cls);
    if (known == g_Bosses.end()) {
        int32_t dataOffset = Reflect::Offset("DominionAICharacter", "LoadedData");
        uintptr_t data = dataOffset >= 0 ? Mem::ReadPtr(creature + (uintptr_t)dataOffset) : 0;
        int32_t boss = Reflect::Offset("AIDataAsset", "bIsBoss");
        known = g_Bosses.emplace(cls, data && boss >= 0 && Mem::ReadU8(data + (uintptr_t)boss) != 0).first;
    }
    return engine->GetObjectName(cls) + (known->second ? " boss" : "");
}

void Report(const PlayerInfo& player, uintptr_t killed) {
    if (CountedAlready(killed)) return;
    EventLog::Event event;
    event.type = "kill";
    event.name = player.characterName.empty() ? player.name : player.characterName;
    event.netId = player.uniqueNetId;
    event.characterGuid = player.characterGuid;
    event.playerId = player.playerId;
    // message: the creature's name as the game shows it (not readable yet);
    // cause: its class, with " boss" after it for a boss.
    event.cause = CreatureClass(killed);
    if (!g_FirstKillLogged) {
        g_FirstKillLogged = true;
        LogMessage("Kills: first kill seen - " + event.name + " killed a " + event.cause);
    }
    g_Status = "counting kills";
    EventLog::Push(std::move(event));
}

// The actor a FatalDamageInfo's KilledBy (a TWeakObjectPtr: index, serial) names.
uintptr_t KilledBy(uintptr_t damageComponent, bool& isSet) {
    isSet = false;
    int32_t infoOffset = Reflect::Offset("DamageComponent", "FatalDamageInfo");
    int32_t byOffset = Reflect::Offset("FatalDamageInfo", "KilledBy");
    int32_t setOffset = Reflect::Offset("FatalDamageInfo", "bIsSet");
    if (!damageComponent || infoOffset < 0 || byOffset < 0 || setOffset < 0) return 0;
    uintptr_t info = damageComponent + (uintptr_t)infoOffset;
    isSet = (Mem::ReadU8(info + (uintptr_t)setOffset) & 1) != 0;
    if (!isSet) return 0;
    return g_Engine->GetObjectByIndex(Mem::ReadI32(info + (uintptr_t)byOffset));
}

}

void Scan(const std::vector<PlayerInfo>& players) {
    Engine* engine = g_Engine;
    if (!engine || !engine->IsInitialized() || players.empty()) return;
    uintptr_t damageType = Reflect::FindType("DamageComponent");
    uintptr_t aiType = Reflect::FindType("DominionAICharacter");
    if (!damageType || !aiType) return;

    std::unordered_set<uintptr_t> dead;
    std::vector<std::pair<uintptr_t, uintptr_t>> newlyDead; // damage component, creature
    engine->ForEachObject([&](uintptr_t object) {
        uintptr_t cls = Mem::ReadPtr(object + Offsets::UObject_Class);
        auto kind = g_DamageClasses.find(cls);
        if (kind == g_DamageClasses.end()) {
            bool is = false;
            for (uintptr_t c = cls, d = 0; c && d < 16 && !is; c = Mem::ReadPtr(c + Offsets::UStruct_SuperStruct), d++) is = c == damageType;
            kind = g_DamageClasses.emplace(cls, is).first;
        }
        if (!kind->second) return true;
        if (Mem::ReadI32(object + Offsets::UObject_Flags) & 0x30) return true; // default object or archetype
        bool isSet = false;
        KilledBy(object, isSet);
        if (!isSet) return true;
        uintptr_t creature = Mem::ReadPtr(object + Offsets::UObject_Outer);
        if (!Reflect::IsA(creature, aiType)) return true; // a player, not a creature
        dead.insert(object);
        if (!g_FirstScan && !g_DeadSeen.count(object)) newlyDead.emplace_back(object, creature);
        return true;
    });

    for (const auto& entry : newlyDead) {
        bool isSet = false;
        uintptr_t killer = KilledBy(entry.first, isSet);
        for (const PlayerInfo& p : players) {
            if (!p.controllerPtr || !IsPlayers(killer, p.controllerPtr, p.pawnPtr)) continue;
            Report(p, entry.second);
            break;
        }
    }
    g_DeadSeen.swap(dead);
    if (g_FirstScan) g_Status = "watching for kills";
    g_FirstScan = false;
}

void KillerOf(const PlayerInfo& victim, const std::vector<PlayerInfo>& players, std::string& cause,
              std::string& message) {
    cause.clear();
    message.clear();
    if (!g_Engine || !victim.damagePtr) return;
    bool isSet = false;
    uintptr_t killer = KilledBy(victim.damagePtr, isSet);
    if (!isSet) return;

    if (killer && IsPlayers(killer, victim.controllerPtr, victim.pawnPtr)) {
        cause = "self";
        return;
    }
    for (const PlayerInfo& p : players) {
        if (p.playerStatePtr == victim.playerStatePtr || !p.controllerPtr) continue;
        if (!killer || !IsPlayers(killer, p.controllerPtr, p.pawnPtr)) continue;
        cause = "player";
        message = p.characterName.empty() ? p.name : p.characterName;
        return;
    }
    // The creature itself, or something it owns (a projectile, a spell).
    uintptr_t aiType = Reflect::FindType("DominionAICharacter");
    for (uintptr_t actor = killer, depth = 0; actor && depth < 4; depth++) {
        if (Reflect::IsA(actor, aiType)) {
            cause = "creature";
            message = CreatureClass(actor);
            return;
        }
        actor = Mem::ReadPtr(actor + Offsets::Actor_Owner);
    }
    cause = killer ? "other" : "self"; // set with nobody to blame: a fall, drowning...
    if (killer) message = g_Engine->GetObjectClassName(killer);
}

const std::string& Status() { return g_Status; }

}
