#pragma once
#include <string>

// Creature kills: UProgressComponent::OnAIKilled, the game's own "a creature
// died, and this is who killed it", is hooked like chat is, and each kill a
// player makes goes to the event feed as a "kill" event.
namespace DomKills {

// Every two seconds, from the init thread: finds the function (it can load
// late) and hooks it once.
void Poll();

bool IsHooked();
const std::string& Status();

}
