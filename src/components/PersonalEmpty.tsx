import type { ReactNode } from 'react'
import { Icon, type IconName } from './Icon'

export function PersonalEmpty({ icon, title, children }: { icon: IconName; title: string; children: ReactNode }) {
  return <div className="personal-empty"><span><Icon name={icon} size={32}/></span><h2>{title}</h2><div>{children}</div></div>
}
