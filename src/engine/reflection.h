#pragma once
#include <cstdint>
#include <string>

// Field offsets looked up by name in the running game's own type information,
// so they're right for the Linux build and survive game updates that move them.
// The layout of the type information itself is worked out at first use by
// finding a field whose offset is already known (SkillComponent.Skills).
namespace Reflect {

// A class or struct by name, without its U/A/F prefix ("QuestProgressComponent",
// "QuestProgress"). 0 when it isn't loaded.
uintptr_t FindType(const std::string& name);

// The offset of a field in a class or struct (searching its parents too), or -1.
int32_t Offset(const std::string& type, const std::string& field);

// The size of a struct, or 0.
int32_t Size(const std::string& type);

// The offset of a field in a struct or function given by pointer (a UFunction's
// fields are its parameters), or -1.
int32_t OffsetIn(uintptr_t type, const std::string& field);

// Whether object's class is the given class or derives from it, by pointer.
bool IsA(uintptr_t object, uintptr_t type);

// An FText's display string, or "" when it can't be read.
std::string ReadText(uintptr_t address);

// For /api/diagnostics.
bool Ready();
const std::string& Status();

}
