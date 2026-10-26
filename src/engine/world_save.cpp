#include "world_save.h"
#include "dom_engine.h"
#include "process_event.h"
#include "../utils/logger.h"
#include "../utils/memory.h"

#include <algorithm>
#include <vector>

namespace DomSave {

namespace {

using namespace DomEngine;

// UFunction::NumParms and ParmsSize sit between FunctionFlags (0xB0) and
// ExecFunction (0xD8). Source: RSDWSDK/CppSDK/Assertions.inl
constexpr uintptr_t kNumParms  = 0xB4;
constexpr uintptr_t kParmsSize = 0xB6;
constexpr size_t kMaxCandidates = 100;

std::string Lower(std::string value) {
    std::transform(value.begin(), value.end(), value.begin(),
                   [](unsigned char c) { return (char)tolower(c); });
    return value;
}

// Save functions on these look like they save the world, rather than one
// item, a UI setting or a player preset.
bool WorldLevelClass(const std::string& className) {
    std::string name = Lower(className);
    for (const char* hint : {"gamemode", "gamestate", "world", "save", "persist", "subsystem"}) {
        if (name.find(hint) != std::string::npos) return true;
    }
    return false;
}

// A live object of the class or a subclass (blueprint classes derive from the
// native one that declares the function), never the class default object.
uintptr_t FindInstance(Engine* engine, const std::string& className) {
    int32_t count = engine->GetObjectCount();
    for (int32_t i = 0; i < count; i++) {
        uintptr_t object = engine->GetObjectByIndex(i);
        if (!object || !Mem::Readable((void*)object, 0x30)) continue;
        if (engine->GetObjectName(object).rfind("Default__", 0) == 0) continue;
        if (engine->GetObjectClassName(object) == "Function") continue;
        if (engine->IsA(object, className.c_str())) return object;
    }
    return 0;
}

}

std::vector<std::string> Candidates() {
    std::vector<std::string> out;
    Engine* engine = g_Engine;
    if (!engine || !engine->IsInitialized()) return out;

    int32_t count = engine->GetObjectCount();
    for (int32_t i = 0; i < count && out.size() < kMaxCandidates; i++) {
        uintptr_t function = engine->GetObjectByIndex(i);
        if (!function || engine->GetObjectClassName(function) != "Function") continue;

        std::string name = engine->GetObjectName(function);
        if (Lower(name).find("save") == std::string::npos) continue;

        std::string owner = engine->GetObjectName(Mem::ReadPtr(function + Offsets::UObject_Outer));
        if (owner.empty() || !WorldLevelClass(owner)) continue;

        uint8_t params = 0xFF;
        if (!Mem::Read(function + kNumParms, params) || params != 0) continue;

        out.push_back(owner + "." + name);
    }
    std::sort(out.begin(), out.end());
    out.erase(std::unique(out.begin(), out.end()), out.end());
    return out;
}

bool Save(const std::string& spec, std::string& outMessage) {
    Engine* engine = g_Engine;
    if (!engine || !engine->IsInitialized()) {
        outMessage = "engine not initialised";
        return false;
    }
    if (!GameThread::IsReady() || !GameThread::HasProcessEvent()) {
        outMessage = "the game thread isn't reachable yet - it is once a player has joined";
        return false;
    }

    size_t dot = spec.find('.');
    if (dot == std::string::npos || dot == 0 || dot + 1 >= spec.size()) {
        outMessage = "give the function as Class.Function - see GET /api/save/candidates";
        return false;
    }
    std::string className = spec.substr(0, dot);
    std::string functionName = spec.substr(dot + 1);

    uintptr_t function = engine->FindFunction(className.c_str(), functionName.c_str());
    if (!function) {
        outMessage = spec + " not found";
        return false;
    }

    // Only functions without parameters: calling anything else with an empty
    // parameter block could do something unintended.
    uint8_t params = 0xFF;
    uint16_t paramsSize = 0;
    if (!Mem::Read(function + kNumParms, params) || params != 0) {
        outMessage = spec + " takes parameters, refusing to call it";
        return false;
    }
    Mem::Read(function + kParmsSize, paramsSize);

    uintptr_t instance = FindInstance(engine, className);
    if (!instance) {
        outMessage = "no live " + className + " to call it on";
        return false;
    }

    std::vector<uint8_t> buffer(std::max<size_t>(paramsSize, 16), 0);
    bool ran = GameThread::RunSync([&]() { GameThread::CallFunction(instance, function, buffer.data()); }, 15000);
    if (!ran) {
        outMessage = "the game thread did not run the save within 15s";
        return false;
    }

    LogMessage("Save: called " + spec + " on " + engine->GetObjectName(instance));
    outMessage = "called " + spec;
    return true;
}

}
