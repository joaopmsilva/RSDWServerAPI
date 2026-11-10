#pragma once
#include "dom_engine.h"

#include <string>
#include <vector>

// Penguin hunting (game 1.0.2): the Killer Gentoo Penguins hidden across the
// map. Each penguin actor lists the characters that have collected it
// (CollectedByPlayerIds), so who found which penguin is read from memory on
// the init thread - nothing is hooked or called on the game thread.
namespace DomPenguins {

// Every tick, but only does anything every 10 s while players are online: each
// (penguin, character) collection not seen before is pushed to the event feed
// as a "penguin" event - characterGuid is the character, message the penguin's
// id (its spawn slot and cycle, the same across restarts), cause its class.
// The first scan after a start reports every collection still on the map, so
// readers count each penguin id once per character.
void Scan(const std::vector<DomEngine::PlayerInfo>& players);

// A copy: the scan updates it on another thread.
std::string Status();

}
