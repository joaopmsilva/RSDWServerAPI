#include "kills.h"
#include "dom_engine.h"
#include "process_event.h"
#include "reflection.h"
#include "../events/event_log.h"
#include "../utils/logger.h"
#include "../utils/memory.h"

#include <chrono>
#include <deque>
#include <unordered_map>
#include <utility>

namespace DomKills {

using namespace DomEngine;

namespace {

typedef void (*ExecThunk)(void* context, void* frame, void* result);
constexpr uintptr_t kExecFunction = 0xD8; // UFunction::Func, as in chat.cpp

using Clock = std::chrono::steady_clock;

ExecThunk g_Original = nullptr;
uintptr_t g_Function = 0;
int32_t g_KilledOffset = -1;
int32_t g_InstigatorOffset = -1;
bool g_Hooked = false;
std::string g_Status = "not found yet";
Clock::time_point g_LastTry;
bool g_FirstKillLogged = false;
// The same creature can be reported to more than one component; count it once.
std::deque<std::pair<uintptr_t, Clock::time_point>> g_Recent;
// Creature class -> (its name in game, whether it's a boss), read once each.
std::unordered_map<uintptr_t, std::pair<std::string, bool>> g_Names;

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

void Report(uintptr_t component, uintptr_t killed, uintptr_t instigator) {
    Engine* engine = g_Engine;
    if (!engine || !killed) return;
    // The component sits on the controller in the SDK; on the character or the
    // player state, find the controller from there.
    uintptr_t controller = Mem::ReadPtr(component + Offsets::UObject_Outer);
    if (controller && engine->IsA(controller, "Pawn")) controller = Mem::ReadPtr(controller + Offsets::Pawn_Controller);
    else if (controller && engine->IsA(controller, "PlayerState")) controller = Mem::ReadPtr(controller + Offsets::Actor_Owner);
    if (!controller || !engine->IsA(controller, "PlayerController")) return;
    uintptr_t pawn = Mem::ReadPtr(controller + Offsets::Controller_Pawn);
    if (instigator && !IsPlayers(instigator, controller, pawn)) return; // someone else's kill
    if (CountedAlready(killed)) return;

    uintptr_t state = Mem::ReadPtr(controller + Offsets::Controller_PlayerState);
    if (!state) return;
    EventLog::Event event;
    event.type = "kill";
    event.name = engine->ReadFString(state + Offsets::PlayerState_PlayerName);
    std::string source;
    event.netId = engine->ReadUniqueNetId(state + Offsets::PlayerState_UniqueID, source);
    if (engine->IsA(state, "DominionPlayerState")) {
        event.characterGuid = engine->ReadGuid(state + Offsets::DomPlayerState_CharacterGuid);
    }
    event.playerId = Mem::ReadI32(state + Offsets::PlayerState_PlayerId);
    // message: the creature's name as the game shows it ("" if unreadable);
    // cause: its class, with " boss" after it for a boss.
    uintptr_t cls = Mem::ReadPtr(killed + Offsets::UObject_Class);
    auto known = g_Names.find(cls);
    if (known == g_Names.end()) {
        std::string name;
        int32_t own = Reflect::Offset("DominionAICharacter", "AIName");
        if (own >= 0) name = Reflect::GameText(killed + (uintptr_t)own);
        int32_t dataOffset = Reflect::Offset("DominionAICharacter", "LoadedData");
        uintptr_t data = dataOffset >= 0 ? Mem::ReadPtr(killed + (uintptr_t)dataOffset) : 0;
        int32_t dataName = Reflect::Offset("AIDataAsset", "AIName");
        if (name.empty() && data && dataName >= 0) name = Reflect::GameText(data + (uintptr_t)dataName);
        int32_t boss = Reflect::Offset("AIDataAsset", "bIsBoss");
        bool isBoss = data && boss >= 0 && Mem::ReadU8(data + (uintptr_t)boss) != 0;
        known = g_Names.emplace(cls, std::make_pair(name, isBoss)).first;
    }
    event.message = known->second.first;
    event.cause = engine->GetObjectName(cls) + (known->second.second ? " boss" : "");
    if (!g_FirstKillLogged) {
        g_FirstKillLogged = true;
        LogMessage("Kills: first kill seen - " + event.name + " killed '" + event.message + "' (" + event.cause + ")");
    }
    EventLog::Push(std::move(event));
}

void KillThunk(void* context, void* frame, void* result) {
    if (GameThread::FrameLayoutReady() && g_KilledOffset >= 0) {
        uintptr_t locals = Mem::ReadPtr((uintptr_t)frame + GameThread::FrameLocalsOffset());
        if (locals) {
            uintptr_t killed = Mem::ReadPtr(locals + (uintptr_t)g_KilledOffset);
            uintptr_t instigator = g_InstigatorOffset >= 0 ? Mem::ReadPtr(locals + (uintptr_t)g_InstigatorOffset) : 0;
            Report((uintptr_t)context, killed, instigator);
        }
    }
    if (g_Original) g_Original(context, frame, result);
}

}

void Poll() {
    if (g_Hooked || !g_Engine || !g_Engine->IsInitialized()) return;
    // Each try is a pass over every object, so at most one every 30 seconds.
    auto now = Clock::now();
    if (g_LastTry.time_since_epoch().count() && now - g_LastTry < std::chrono::seconds(30)) return;
    g_LastTry = now;

    if (!g_Function) g_Function = g_Engine->FindFunction("ProgressComponent", "OnAIKilled");
    if (!g_Function) {
        g_Status = "OnAIKilled not found yet";
        return;
    }
    g_KilledOffset = Reflect::OffsetIn(g_Function, "KilledCharacter");
    g_InstigatorOffset = Reflect::OffsetIn(g_Function, "Instigator");
    uintptr_t original = Mem::ReadPtr(g_Function + kExecFunction);
    if (g_KilledOffset < 0 || !original || !Mem::InImage((void*)original)) {
        g_Status = "OnAIKilled has no usable parameters or thunk";
        return;
    }
    g_Original = (ExecThunk)original;
    *(uintptr_t*)(g_Function + kExecFunction) = (uintptr_t)&KillThunk;
    g_Hooked = true;
    g_Status = "hooked";
    LogMessage("Kills: counting creature kills from ProgressComponent.OnAIKilled");
}

bool IsHooked() { return g_Hooked; }
const std::string& Status() { return g_Status; }

}
