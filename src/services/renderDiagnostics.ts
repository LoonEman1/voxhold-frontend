import type { ErrorInfo } from 'react'
import { clientDiagnostics } from '../platform/clientDiagnostics'

/** Identify failing code without uploading messages, arbitrary error text or stacks. */
export function recordRenderError(error: Error, info: ErrorInfo, boundary: string) {
  const reading = /(?:reading ['"])([A-Za-z_$][\w$]{0,63})/.exec(error.message)
  const missingFunction = /(?:^|\.)([A-Za-z_$][\w$]{0,63}) is not a function/.exec(error.message)
  const components = [...(info.componentStack ?? '').matchAll(/^\s+at ([A-Za-z_$][\w$]{0,79})/gm)].slice(0, 8).map((match) => match[1]).join(' > ')
  clientDiagnostics.record('client', 'render_error', 'error', {
    error_name: error.name, boundary, component_stack_present: !!info.componentStack,
    component_names: components || 'unknown',
    failure_kind: reading ? 'property_access' : missingFunction ? 'missing_function' : 'render_exception',
    property_name: reading?.[1] ?? missingFunction?.[1] ?? '',
  })
}
