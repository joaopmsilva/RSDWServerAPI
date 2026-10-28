#pragma once
#include <string>

// Game settings from settings.ini's [Game] section, written straight into the
// game's own settings object, the way client-side UE4SS mods do. Today that's
// LinkedStorageRadius: how far linked chests reach for building and crafting.
// The server checks the chests a client sends against it, so it has to match
// the radius players' clients use (ChestLink), or every build is refused.
namespace DomGameSettings {

// Every two seconds, from the init thread: finds the settings object once,
// then keeps the configured values in it.
void Apply();

const std::string& Status();

}
