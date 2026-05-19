/** Chat send: tool loop is the app default send path (SA-7, wired SA-11). */
export {
  buildApiMessages,
  MAX_TOOL_TURNS,
  sendMessageWithTools,
  sendMessageWithTools as sendMessage,
} from '../tools/loop';
/** Non-tool send (legacy / internal). */
export { sendMessage as sendMessagePlain } from '../api/chat';
