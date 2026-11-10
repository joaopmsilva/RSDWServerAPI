#include "penguins.h"
#include "dom_engine.h"
#include "reflection.h"
#include "../events/event_log.h"
#include "../utils/logger.h"
#include "../utils/memory.h"

#include <chrono>
#include <cstring>
#include <mutex>
#include <unordered_map>
#include <unordered_set>

namespace DomPenguins {

using namespace DomEngine;

namespace {

using Clock = std::chrono::steady_clock;
constexpr auto kEvery = std::chrono::seconds(10);
constexpr size_t kGuidSize = 16; // FDomCharacterGuid is one FGuid

std::mutex g_StatusMutex;
std::string g_Status = "waiting for a player";

void SetStatus(std::string status) {
    std::lock_guard<std::mutex> lock(g_StatusMutex);
    g_Status = std::move(status);
}
Clock::time_point g_Last;
// "penguin id|character guid" pairs already reported this run.
std::unordered_set<std::string> g_Reported;
std::unordered_map<uintptr_t, int> g_Classes; // class -> 1 penguin, 2 hunting system, 0 neither
bool g_FirstLogged = false;

int Kind(uintptr_t cls, uintptr_t penguinType, uintptr_t systemType) {
    auto known = g_Classes.find(cls);
    if (known != g_Classes.end()) return known->second;
    int kind = 0;
    for (uintptr_t c = cls, d = 0; c && d < 16 && !kind; c = Mem::ReadPtr(c + Offsets::UStruct_SuperStruct), d++) {
        if (c == penguinType) kind = 1;
        else if (systemType && c == systemType) kind = 2;
    }
    g_Classes.emplace(cls, kind);
    return kind;
}

}

void Scan(const std::vector<PlayerInfo>& players) {
    Engine* engine = g_Engine;
    if (!engine || !engine->IsInitialized() || players.empty()) return;
    auto now = Clock::now();
    if (g_Last.time_since_epoch().count() && now - g_Last < kEvery) return;
    g_Last = now;

    uintptr_t penguinType = Reflect::FindType("Penguin");
    if (!penguinType) {
        SetStatus("no penguins in this game version");
        return;
    }
    uintptr_t systemType = Reflect::FindType("PenguinHuntingSystem");
    int32_t slotOffset = Reflect::Offset("Penguin", "SpawnedInSlotID_ServerOnly");
    int32_t collectedOffset = Reflect::Offset("Penguin", "CollectedByPlayerIds");
    int32_t cycleOffset = systemType ? Reflect::Offset("PenguinHuntingSystem", "NextCycleInGameTime_ServerOnly") : -1;
    if (slotOffset < 0 || collectedOffset < 0) {
        SetStatus("penguin fields not found");
        return;
    }

    struct Penguin {
        uintptr_t actor;
        std::string slot;
    };
    std::vector<Penguin> penguins;
    int64_t cycle = 0;
    engine->ForEachObject([&](uintptr_t object) {
        int kind = Kind(Mem::ReadPtr(object + Offsets::UObject_Class), penguinType, systemType);
        if (!kind) return true;
        if (Mem::ReadI32(object + Offsets::UObject_Flags) & 0x30) return true; // default object or archetype
        if (kind == 2) {
            if (cycleOffset >= 0) Mem::Read(object + (uintptr_t)cycleOffset, cycle);
            return true;
        }
        std::string slot = engine->ReadGuid(object + (uintptr_t)slotOffset);
        if (!slot.empty()) penguins.push_back({object, slot});
        return true;
    });

    // Slots are reused every cycle; the cycle's end time tells the spawns apart.
    std::string suffix = cycle ? "-" + std::to_string(cycle) : "";
    std::unordered_set<std::string> current;
    size_t collections = 0;
    for (const Penguin& penguin : penguins) {
        FUEArray list = {};
        uintptr_t listAddress = penguin.actor + (uintptr_t)collectedOffset;
        if (!Mem::Readable((void*)listAddress, sizeof(list))) continue;
        memcpy(&list, (void*)listAddress, sizeof(list));
        if (!list.Data || list.Num <= 0 || list.Num > 256) continue;
        if (!Mem::Readable(list.Data, kGuidSize * (size_t)list.Num)) continue;

        std::string id = penguin.slot + suffix;
        for (int32_t i = 0; i < list.Num; i++) {
            std::string guid = engine->ReadGuid((uintptr_t)list.Data + (uintptr_t)i * kGuidSize);
            if (guid.empty()) continue;
            collections++;
            std::string pair = id + "|" + guid;
            current.insert(pair);
            if (g_Reported.count(pair)) continue;

            EventLog::Event event;
            event.type = "penguin";
            event.characterGuid = guid;
            event.message = id;
            event.cause = engine->GetObjectClassName(penguin.actor);
            for (const PlayerInfo& p : players) {
                if (p.characterGuid != guid) continue;
                event.name = p.characterName.empty() ? p.name : p.characterName;
                event.netId = p.uniqueNetId;
                event.playerId = p.playerId;
                break;
            }
            if (!g_FirstLogged) {
                g_FirstLogged = true;
                LogMessage("Penguins: first collection seen - " + (event.name.empty() ? guid : event.name) +
                           " has " + event.cause);
            }
            EventLog::Push(std::move(event));
        }
    }
    // Penguins gone (a new cycle) drop out; a pair seen again later is a new spawn.
    g_Reported.swap(current);
    SetStatus(std::to_string(penguins.size()) + " penguins out, collected " + std::to_string(collections) +
               " times" + (cycle ? "" : " (cycle unknown)"));
}

std::string Status() {
    std::lock_guard<std::mutex> lock(g_StatusMutex);
    return g_Status;
}

}
