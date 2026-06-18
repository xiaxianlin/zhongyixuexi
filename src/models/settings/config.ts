/**
 * Fixed AI provider slot definitions. The settings UI renders one editable card
 * per slot; slots are identified by a stable id (also used as the provider row
 * id in api_credentials) and carry sensible defaults for the provider/baseUrl/
 * model shown when no row exists yet.
 */
export interface AiConfigSlot {
  id: string
  title: string
  description: string
  provider: string
  baseUrl: string
  model: string
}

export const AI_CONFIG_SLOTS: AiConfigSlot[] = [
  {
    id: 'conversation-ai',
    title: '会话配置',
    description: '用于 AI 解读、白话、医理等文本会话能力。',
    provider: 'deepseek',
    baseUrl: 'https://api.deepseek.com/v1',
    model: 'deepseek-v4-flash',
  },
  {
    id: 'image-generation-ai',
    title: '图片生成配置',
    description: '用于后续图片生成、图片编辑等视觉生成能力。',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    model: 'gpt-image-1',
  },
]
