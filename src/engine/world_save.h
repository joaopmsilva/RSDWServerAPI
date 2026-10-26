#pragma once
#include <string>
#include <vector>

// Asking the game to save the world, so a backup copies a finished save
// instead of one the game may be halfway through writing.
//
// The game's save function has no fixed name the mod can rely on, so it is
// picked once per game version: Candidates() lists every zero-argument
// function with "save" in its name on a world-level class, and Save() calls
// the chosen "Class.Function" on the live instance, on the game thread.
namespace DomSave {

std::vector<std::string> Candidates();

bool Save(const std::string& spec, std::string& outMessage);

}
