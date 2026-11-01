#include "world.h"
#include "dom_engine.h"
#include "reflection.h"
#include "../utils/logger.h"
#include "../utils/memory.h"

#include <chrono>
#include <cstdio>
#include <mutex>
#include <unordered_map>

namespace DomWorld {

using namespace DomEngine;

namespace {

// EInternalObjectFlags on FUObjectItem: Garbage (destroyed, waiting for the
// garbage collector) and Unreachable. Source: UObjectArray.h, UE 5.x.
constexpr int32_t kItemFlags = 0x08;
constexpr int32_t kGarbage = 1 << 21;
constexpr int32_t kUnreachable = 1 << 28;
// EObjectFlags: class default object, archetype, being destroyed.
constexpr int32_t kTemplateOrDying = 0x10 | 0x20 | 0x8000 | 0x10000;

std::mutex g_Mutex;
// Which classes are events or counted data, by class pointer, so the pass over
// every object costs one read each.
std::unordered_map<uintptr_t, int> g_ClassKinds; // 0 none, 1 raid, 2 hunted, 4 quest, 5 journal entry
bool g_FirstEventLogged = false;

bool ItemAlive(const Engine* engine, uintptr_t object) {
    int32_t index = Mem::ReadI32(object + Offsets::UObject_Index);
    uintptr_t gObjects = engine->GetGObjects();
    if (index < 0 || !gObjects) return false;
    uintptr_t chunks = Mem::ReadPtr(gObjects + Offsets::ObjArray_Objects);
    uintptr_t chunk = Mem::ReadPtr(chunks + (uintptr_t)(index / Offsets::ObjectsPerChunk) * sizeof(uintptr_t));
    if (!chunk) return false;
    uintptr_t item = chunk + (uintptr_t)(index % Offsets::ObjectsPerChunk) * Offsets::ObjectItem_Size;
    int32_t flags = Mem::ReadI32(item + kItemFlags);
    return (flags & (kGarbage | kUnreachable)) == 0;
}

int KindOfClass(uintptr_t cls, uintptr_t raid, uintptr_t hunted, uintptr_t quest, uintptr_t journal) {
    auto it = g_ClassKinds.find(cls);
    if (it != g_ClassKinds.end()) return it->second;
    int kind = 0;
    for (uintptr_t c = cls; c && kind == 0; c = Mem::ReadPtr(c + Offsets::UStruct_SuperStruct)) {
        if (raid && c == raid) kind = 1;
        else if (hunted && c == hunted) kind = 2;
        else if (quest && c == quest) kind = 4;
        else if (journal && c == journal) kind = 5;
    }
    g_ClassKinds[cls] = kind;
    return kind;
}

std::string Difficulty(uint8_t value) {
    static const char* names[] = {"normal", "hard", "creative", "custom"};
    return value < 4 ? names[value] : "";
}

std::string Hardcore(uint8_t value) {
    static const char* names[] = {"", "off", "active", "failed", "succeeded"};
    return value < 5 ? names[value] : "";
}

void ReadSettings(const Engine* engine, uintptr_t gameState, State& out) {
    int32_t infoOffset = Reflect::Offset("DominionGameStateBase", "WorldInfo");
    int32_t nameOffset = Reflect::Offset("WorldInformation", "WorldName");
    int32_t hostOffset = Reflect::Offset("WorldInformation", "HostUserName");
    if (infoOffset >= 0 && nameOffset >= 0) {
        out.worldName = engine->ReadFString(gameState + (uintptr_t)infoOffset + (uintptr_t)nameOffset);
    }
    if (infoOffset >= 0 && hostOffset >= 0) {
        out.host = engine->ReadFString(gameState + (uintptr_t)infoOffset + (uintptr_t)hostOffset);
    }

    int32_t componentOffset = Reflect::Offset("DominionGameStateBase", "SurvivalDifficultyComponent");
    int32_t settingsOffset = Reflect::Offset("SurvivalDifficultyComponent", "ReplicatedDifficultySettings");
    int32_t difficultyOffset = Reflect::Offset("ReplicatedDifficultySettings", "Difficulty");
    if (componentOffset >= 0 && settingsOffset >= 0 && difficultyOffset >= 0) {
        uintptr_t component = Mem::ReadPtr(gameState + (uintptr_t)componentOffset);
        if (component) {
            out.difficulty = Difficulty(Mem::ReadU8(component + (uintptr_t)settingsOffset + (uintptr_t)difficultyOffset));
        }
    }

    int32_t hardcoreOffset = Reflect::Offset("DominionGameStateBase", "WorldHardcoreState");
    if (hardcoreOffset < 0) hardcoreOffset = (int32_t)Offsets::DomGameState_WorldHardcoreState;
    out.hardcore = Hardcore(Mem::ReadU8(gameState + (uintptr_t)hardcoreOffset));
}

void ReadEvents(Engine* engine, State& out) {
    uintptr_t raid = Reflect::FindType("BaseRaidEvent");
    uintptr_t hunted = Reflect::FindType("HuntedEvent");
    uintptr_t quest = Reflect::FindType("QuestData");
    uintptr_t journal = Reflect::FindType("JournalEntryData");
    if (!raid && !hunted && !quest && !journal) return;
    int32_t hiddenOffset = Reflect::Offset("QuestData", "bHideInQuestList");

    int32_t raidRadius = Reflect::Offset("BaseRaidEvent", "EventRadius");
    int32_t huntedRadius = Reflect::Offset("HuntedEvent", "MaxPlayerDistanceFromSpawnRadiusForConsideration");

    engine->ForEachObject([&](uintptr_t object) {
        int kind = KindOfClass(Mem::ReadPtr(object + Offsets::UObject_Class), raid, hunted, quest, journal);
        if (!kind) return true;
        if (Mem::ReadI32(object + Offsets::UObject_Flags) & kTemplateOrDying) return true;

        // Data assets: count them. Quests left in the game's Deleted folder or
        // hidden from the quest list don't count.
        if (kind == 4) {
            if (hiddenOffset >= 0 && Mem::ReadU8(object + (uintptr_t)hiddenOffset)) return true;
            if (engine->GetObjectName(Mem::ReadPtr(object + Offsets::UObject_Outer)).find("/Deleted/") != std::string::npos) return true;
            out.totalQuests++;
            return true;
        }
        if (kind == 5) {
            out.totalJournal++;
            return true;
        }
        if (!ItemAlive(engine, object)) return true;

        EventInfo event;
        event.type = kind == 1 ? "raid" : "hunted";
        event.name = engine->GetObjectClassName(object);
        char id[32];
        snprintf(id, sizeof(id), "%d-%llx", Mem::ReadI32(object + Offsets::UObject_Index), (unsigned long long)object);
        event.id = id;

        uintptr_t root = Mem::ReadPtr(object + Offsets::Actor_RootComponent);
        if (root && Mem::Readable((void*)(root + Offsets::SceneComp_RelativeLocation), 24)) {
            event.x = Mem::ReadDouble(root + Offsets::SceneComp_RelativeLocation);
            event.y = Mem::ReadDouble(root + Offsets::SceneComp_RelativeLocation + 8);
            event.z = Mem::ReadDouble(root + Offsets::SceneComp_RelativeLocation + 16);
            event.hasLocation = true;
        }
        if (kind == 1 && raidRadius >= 0) event.radius = Mem::ReadFloat(object + (uintptr_t)raidRadius);
        if (kind == 2 && huntedRadius >= 0) event.radius = Mem::ReadDouble(object + (uintptr_t)huntedRadius);
        if (!(event.radius > 0 && event.radius < 1e7)) event.radius = 0;

        if (!g_FirstEventLogged) {
            g_FirstEventLogged = true;
            LogMessage("World: first " + event.type + " event seen: " + event.name);
        }
        out.events.push_back(event);
        return true;
    });
}

}

State Read() {
    State out;
    Engine* engine = g_Engine;
    if (!engine || !engine->IsInitialized() || !Reflect::Ready()) return out;
    uintptr_t gameState = engine->GetGameState();
    if (!gameState || !engine->IsA(gameState, "DominionGameStateBase")) return out;

    std::lock_guard<std::mutex> lock(g_Mutex);
    out.valid = true;
    ReadSettings(engine, gameState, out);
    ReadEvents(engine, out);
    return out;
}

}
