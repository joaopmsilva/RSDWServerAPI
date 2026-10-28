#pragma once
#include "dom_engine.h"

#include <string>
#include <vector>

// Creature kills: UProgressComponent::OnAIKilled, the game's own "a creature
// died, and this is who killed it", is hooked like chat is, and each kill a
// player makes goes to the event feed as a "kill" event.
namespace DomKills {

// Every two seconds, from the init thread: finds the function (it can load
// late) and hooks it once.
void Poll();

// Every two seconds while players are online: creatures that have died since
// the last scan, from their damage component's FatalDamageInfo (KilledBy).
// This catches kills the hook doesn't, when the game calls OnAIKilled directly.
void Scan(const std::vector<DomEngine::PlayerInfo>& players);

bool IsHooked();
const std::string& Status();

}
