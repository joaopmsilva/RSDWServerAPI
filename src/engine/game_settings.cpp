#include "game_settings.h"
#include "dom_engine.h"
#include "reflection.h"
#include "../config/config.h"
#include "../utils/logger.h"
#include "../utils/memory.h"

#include <chrono>
#include <cstdio>

namespace DomGameSettings {

using namespace DomEngine;

namespace {

using Clock = std::chrono::steady_clock;

constexpr int32_t kClassDefaultObject = 0x10; // RF_ClassDefaultObject

uintptr_t g_Settings = 0; // Default__InventorySettings
Clock::time_point g_LastSearch;
bool g_Logged = false;
std::string g_Status = "not applied yet";

std::string Number(float value) {
    char buffer[32];
    snprintf(buffer, sizeof(buffer), "%.0f", value);
    return buffer;
}

// GetDefault<UInventorySettings>(): the class default object, found once.
uintptr_t FindSettings() {
    Engine* engine = g_Engine;
    uintptr_t type = Reflect::FindType("InventorySettings");
    if (!type) return 0;
    int32_t count = engine->GetObjectCount();
    for (int32_t i = 0; i < count; i++) {
        uintptr_t object = engine->GetObjectByIndex(i);
        if (!object || Mem::ReadPtr(object + Offsets::UObject_Class) != type) continue;
        if (Mem::ReadI32(object + Offsets::UObject_Flags) & kClassDefaultObject) return object;
    }
    return 0;
}

}

void Apply() {
    float radius = g_Config.game.linkedStorageRadius;
    if (radius <= 0) {
        g_Status = "LinkedStorageRadius left as the game has it";
        return;
    }
    if (!g_Engine || !g_Engine->IsInitialized() || !Reflect::Ready()) return;

    int32_t offset = Reflect::Offset("InventorySettings", "LinkedStorageRadius");
    if (offset < 0) {
        g_Status = "InventorySettings.LinkedStorageRadius not found";
        return;
    }
    if (!g_Settings) {
        // A pass over every object, so at most one every 30 seconds.
        auto now = Clock::now();
        if (g_LastSearch.time_since_epoch().count() && now - g_LastSearch < std::chrono::seconds(30)) return;
        g_LastSearch = now;
        g_Settings = FindSettings();
        if (!g_Settings) {
            g_Status = "InventorySettings not loaded yet";
            return;
        }
    }

    uintptr_t field = g_Settings + (uintptr_t)offset;
    float current = Mem::ReadFloat(field, -1.0f);
    if (current < 0) {
        g_Status = "LinkedStorageRadius unreadable";
        return;
    }
    if (!g_Logged) {
        g_Logged = true;
        LogMessage("Game settings: LinkedStorageRadius was " + Number(current) + ", set to " + Number(radius));
    }
    if (current != radius) *(float*)field = radius;
    g_Status = "LinkedStorageRadius " + Number(Mem::ReadFloat(field)) + " (settings.ini " + Number(radius) + ")";
}

const std::string& Status() { return g_Status; }

}
