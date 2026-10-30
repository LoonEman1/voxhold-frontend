import { isEditableKeyboardTarget } from '../services/voiceSettings'

export function preferNativeContextMenu(event: { target: EventTarget | null; shiftKey: boolean }): boolean {
  const target = event.target
  return event.shiftKey || isEditableKeyboardTarget(target)
    || target instanceof Element && !!target.closest('a[href],textarea,input,select,[contenteditable="true"],[contenteditable=""]')
    || !!window.getSelection()?.toString()
}
