#pragma once
#include "dom_engine.h"

#include <string>
#include <vector>

// Creature kills, and what killed a player. Both come from a damage
// component's FatalDamageInfo (KilledBy), read from memory on the init thread:
// nothing is hooked or called on the game thread.
namespace DomKills {

// Every tick while players are online: creatures that have died since the
// last scan, pushed to the event feed as "kill" events.
void Scan(const std::vector<DomEngine::PlayerInfo>& players);

// What killed this player, from their pawn's damage component. cause is
// "creature" (message: its class, then " boss" for a boss), "player"
// (message: their name), "self" or "" when the game didn't say.
void KillerOf(const DomEngine::PlayerInfo& victim, const std::vector<DomEngine::PlayerInfo>& players,
              std::string& cause, std::string& message);

const std::string& Status();

}
