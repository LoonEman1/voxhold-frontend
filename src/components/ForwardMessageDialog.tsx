import type { Channel, Message, Server, ServerMember } from '../domain/types'
import type { VoxholdApi } from '../services/api'
import { UniversalForward } from './CommunityFeatures'
export function ForwardMessageDialog({source,api,token,onClose}:{source:{serverId:number;message:Message};servers:Server[];members:ServerMember[];api:VoxholdApi;token:string;onClose:()=>void;onForward:(serverId:number,channel:Channel,key:string)=>Promise<void>}){
 return <UniversalForward api={api} token={token} source={{kind:'channel',id:source.message.id}} onClose={onClose}/>
}
