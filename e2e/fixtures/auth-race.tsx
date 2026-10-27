import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AuthProvider, useAuth } from '../../src/auth/AuthContext'
import { browserSessionStorage, createFetchTransport } from '../../src/platform/transport'
import { createApi } from '../../src/services/api'
const api=createApi(createFetchTransport())
function Probe(){const auth=useAuth();return <><p>{auth.ready ? auth.token ?? 'logged-out' : 'loading'}</p><button onClick={()=>void auth.logout()}>Logout</button></>}
createRoot(document.getElementById('root')!).render(<StrictMode><AuthProvider api={api} storage={browserSessionStorage}><Probe/></AuthProvider></StrictMode>)
