import { conversationHandler } from '@/services/assistant-chat-handler';
type Context={params:Promise<{id:string}>};
async function handle(request:Request,{params}:Context){return conversationHandler(request,(await params).id);}
export {handle as GET,handle as PATCH,handle as DELETE};
