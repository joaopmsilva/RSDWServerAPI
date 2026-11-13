#pragma once
#include <string>

// Game settings from settings.ini's [Game] section, written straight into the
// game's own settings object. Optional and off by default: nothing is written
// unless the section is set by hand.
namespace DomGameSettings {

// Every two seconds, from the init thread: finds the settings object once,
// then keeps the configured values in it.
void Apply();

const std::string& Status();

}
