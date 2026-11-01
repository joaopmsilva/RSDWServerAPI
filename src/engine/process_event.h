#pragma once
#include <cstdint>
#include <functional>
#include <string>

namespace GameThread {

typedef void (*ProcessEventFn)(void* self, void* function, void* params);

bool Initialize(uintptr_t moduleBase, uintptr_t moduleEnd);

bool InstallExecPump();

bool IsReady();
bool IsGameThread();

bool HasProcessEvent();

bool FrameLayoutReady();
uintptr_t FrameNodeOffset();
uintptr_t FrameObjectOffset();
uintptr_t FrameCodeOffset();
uintptr_t FrameLocalsOffset();
uintptr_t FramePropertyChainOffset();
uintptr_t ProcessEventAddress();
const std::string& Status();

bool RunSync(const std::function<void()>& work, int timeoutMs = 5000);

void CallFunction(uintptr_t object, uintptr_t function, void* params);

int VTableIndex();
// UObject::ProcessEvent itself, for a hook that has no recorded original.
ProcessEventFn OriginalProcessEvent();
// The address of the ProcessEvent slot in the object's vtable, or 0. Read the
// function there and record it before HookVTable replaces it, so a hook never
// runs without knowing what to call on to.
uintptr_t VTableSlot(uintptr_t object);
bool HookVTable(uintptr_t slotAddress, ProcessEventFn hook);

}
