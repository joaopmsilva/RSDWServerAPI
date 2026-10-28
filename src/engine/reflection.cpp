#include "reflection.h"
#include "dom_engine.h"
#include "../utils/logger.h"
#include "../utils/memory.h"

#include <chrono>
#include <mutex>
#include <unordered_map>

namespace Reflect {

using namespace DomEngine;

namespace {

struct Layout {
    uintptr_t childProperties = 0; // UStruct -> first FField
    uintptr_t next = 0;            // FField -> next FField
    uintptr_t name = 0;            // FField -> FName
    uintptr_t offset = 0;          // FProperty -> Offset_Internal
    uintptr_t structSize = 0;      // UStruct -> PropertiesSize
};

// The anchor the layout is checked against: a field the mod already reads at a
// known offset (Offsets::Skill_Skills), and a struct of known size (FSkill).
constexpr const char* kAnchorClass = "SkillComponent";
constexpr const char* kAnchorField = "Skills";
constexpr const char* kAnchorStruct = "Skill";

using Clock = std::chrono::steady_clock;

std::mutex g_Mutex;
Layout g_Layout;
bool g_Calibrated = false;
std::string g_Status = "not checked yet";
std::unordered_map<std::string, uintptr_t> g_Types;
Clock::time_point g_TypesBuilt;
bool g_TypesEverBuilt = false;
std::unordered_map<std::string, int32_t> g_Offsets;

std::string NameAt(uintptr_t address) {
    if (!g_Engine || !Mem::Readable((void*)address, 8)) return "";
    return g_Engine->NameToString((uint32_t)Mem::ReadI32(address), (uint32_t)Mem::ReadI32(address + 4));
}

// One pass over every object, remembering the classes and structs by name.
void BuildTypes() {
    g_Types.clear();
    g_Offsets.clear();
    int32_t count = g_Engine->GetObjectCount();
    for (int32_t i = 0; i < count; i++) {
        uintptr_t object = g_Engine->GetObjectByIndex(i);
        if (!object) continue;
        std::string kind = g_Engine->GetObjectClassName(object);
        if (kind != "Class" && kind != "BlueprintGeneratedClass" && kind != "ScriptStruct") continue;
        std::string name = g_Engine->GetObjectName(object);
        if (!name.empty()) g_Types.emplace(name, object);
    }
    g_TypesBuilt = Clock::now();
    g_TypesEverBuilt = true;
}

uintptr_t TypeLocked(const std::string& name) {
    if (!g_Engine || !g_Engine->IsInitialized()) return 0;
    auto it = g_Types.find(name);
    if (it != g_Types.end()) return it->second;
    // Not loaded yet, or loaded since the last pass: look again at most once a minute.
    if (!g_TypesEverBuilt || Clock::now() - g_TypesBuilt > std::chrono::seconds(60)) {
        BuildTypes();
        it = g_Types.find(name);
        if (it != g_Types.end()) return it->second;
    }
    return 0;
}

uintptr_t FieldNamed(uintptr_t type, const std::string& field, const Layout& layout) {
    for (uintptr_t s = type; s; s = Mem::ReadPtr(s + Offsets::UStruct_SuperStruct)) {
        uintptr_t f = Mem::ReadPtr(s + layout.childProperties);
        for (int steps = 0; f && steps < 2000; steps++) {
            if (NameAt(f + layout.name) == field) return f;
            f = Mem::ReadPtr(f + layout.next);
        }
    }
    return 0;
}

bool CalibrateLocked() {
    if (g_Calibrated) return true;
    uintptr_t anchor = TypeLocked(kAnchorClass);
    uintptr_t skill = TypeLocked(kAnchorStruct);
    if (!anchor || !skill) {
        g_Status = "waiting for SkillComponent to load";
        return false;
    }

    // UE 5.x layouts: FFieldVariant is 0x10 before 5.4-ish and 0x8 after.
    const uintptr_t children[] = {0x50, 0x48};
    const uintptr_t links[][2] = {{0x20, 0x28}, {0x18, 0x20}};
    const uintptr_t offsets[] = {0x4C, 0x44, 0x48, 0x40};
    const uintptr_t sizes[] = {0x58, 0x50, 0x5C, 0x54};

    for (uintptr_t child : children) {
        for (const auto& link : links) {
            Layout layout;
            layout.childProperties = child;
            layout.next = link[0];
            layout.name = link[1];
            uintptr_t field = FieldNamed(anchor, kAnchorField, layout);
            if (!field) continue;
            for (uintptr_t offset : offsets) {
                if (Mem::ReadI32(field + offset) != (int32_t)Offsets::Skill_Skills) continue;
                layout.offset = offset;
                for (uintptr_t size : sizes) {
                    if (Mem::ReadI32(skill + size) == (int32_t)Offsets::FSkill_Size) {
                        layout.structSize = size;
                        break;
                    }
                }
                g_Layout = layout;
                g_Calibrated = true;
                char buf[160];
                snprintf(buf, sizeof(buf),
                         "ok (fields at +0x%lX, next +0x%lX, name +0x%lX, offset +0x%lX, size +0x%lX)",
                         (unsigned long)child, (unsigned long)link[0], (unsigned long)link[1],
                         (unsigned long)offset, (unsigned long)layout.structSize);
                g_Status = buf;
                LogMessage("Reflection: " + g_Status);
                return true;
            }
        }
    }
    g_Status = "the game's type information has an unknown layout";
    LogMessage("Reflection: " + g_Status + " - quests, journal, perks and world info are off");
    return false;
}

bool LooksLikeKey(const std::string& s) {
    if (s.size() == 32) {
        for (char c : s) {
            if (!isxdigit((unsigned char)c)) return false;
        }
        return true;
    }
    return !s.empty() && s[0] == '[';
}

bool Printable(const std::string& s) {
    if (s.empty() || s.size() > 256) return false;
    for (unsigned char c : s) {
        if (c < 0x20) return false;
    }
    return true;
}

}

uintptr_t FindType(const std::string& name) {
    std::lock_guard<std::mutex> lock(g_Mutex);
    return TypeLocked(name);
}

int32_t Offset(const std::string& type, const std::string& field) {
    std::lock_guard<std::mutex> lock(g_Mutex);
    if (!CalibrateLocked()) return -1;
    std::string key = type + "." + field;
    auto it = g_Offsets.find(key);
    if (it != g_Offsets.end()) return it->second;

    uintptr_t t = TypeLocked(type);
    if (!t) return -1; // not cached: the type may load later
    uintptr_t f = FieldNamed(t, field, g_Layout);
    int32_t offset = f ? Mem::ReadI32(f + g_Layout.offset) : -1;
    if (offset < 0 || offset > 0x10000) offset = -1;
    if (offset < 0) LogMessage("Reflection: no field " + key);
    g_Offsets[key] = offset;
    return offset;
}

int32_t Size(const std::string& type) {
    std::lock_guard<std::mutex> lock(g_Mutex);
    if (!CalibrateLocked() || !g_Layout.structSize) return 0;
    uintptr_t t = TypeLocked(type);
    if (!t) return 0;
    int32_t size = Mem::ReadI32(t + g_Layout.structSize);
    return size > 0 && size < 0x10000 ? size : 0;
}

bool IsA(uintptr_t object, uintptr_t type) {
    if (!object || !type) return false;
    uintptr_t c = Mem::ReadPtr(object + Offsets::UObject_Class);
    for (int depth = 0; c && depth < 32; depth++) {
        if (c == type) return true;
        c = Mem::ReadPtr(c + Offsets::UStruct_SuperStruct);
    }
    return false;
}

// FText holds a pointer to its text data; the display string sits somewhere in
// that object, either inline or behind a shared pointer. Take the first string
// that reads cleanly and isn't the localisation key or namespace.
std::string ReadText(uintptr_t address) {
    if (!g_Engine) return "";
    uintptr_t data = Mem::ReadPtr(address);
    if (!data || !Mem::Readable((void*)data, 0x70)) return "";
    for (uintptr_t off = 0x08; off < 0x70; off += 8) {
        std::string inlineString = g_Engine->ReadFString(data + off);
        if (Printable(inlineString) && !LooksLikeKey(inlineString)) return inlineString;
        uintptr_t pointed = Mem::ReadPtr(data + off);
        if (pointed && Mem::Readable((void*)pointed, sizeof(FString))) {
            std::string viaPointer = g_Engine->ReadFString(pointed);
            if (Printable(viaPointer) && !LooksLikeKey(viaPointer)) return viaPointer;
        }
    }
    return "";
}

bool Ready() {
    std::lock_guard<std::mutex> lock(g_Mutex);
    return CalibrateLocked();
}

const std::string& Status() {
    std::lock_guard<std::mutex> lock(g_Mutex);
    return g_Status;
}

}
