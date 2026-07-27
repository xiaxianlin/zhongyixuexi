/**
 * Red-line guard — ported verbatim from electron/ai/guard.ts. Three layers:
 * Layer 1 (system prompt, see prompts.ts), Layer 2 (this file, `shouldBlock`:
 * pre-call keyword scan — refuse without calling the model, no network, no
 * billing), Layer 3 (this file, `sanitizeOutput`: post-call dosage/prescription
 * scrub). The AI-05 question route needs this MORE than AI-01's fixed-template
 * paragraph analysis did, since free-form questions have a much larger surface
 * for "what should I take for X" framing.
 */
export interface GuardResult {
  blocked: boolean
  refusal: string
}

export const REFUSAL_TEXT =
  '本工具仅用于古籍学习与理解，不能提供诊疗或用药建议。如果你有健康相关问题，请咨询执业医师。'

const BLOCK_PATTERNS: RegExp[] = [
  /(我|家人|父亲|母亲|孩子|宝宝|老人).{0,6}(得了|确诊|患有|罹患|感染)/,
  /(怎么|如何|怎样|咋|能否|可以).{0,4}(治|治疗|医治|治愈|治好|调理)/,
  /(吃|用|服|开|抓|买).{0,3}(什么|啥|哪种|哪些).{0,3}(药|方|方子|中草药)/,
  /(给我|帮我|请).{0,4}(开方|开个方|处方|配药|推荐药)/,
  /(剂量|用量|用法用量|吃多少|服多少|多少克|几克|几钱|几两).{0,6}(药|服用|吃)/,
  /(药.{0,4})?(剂量|用量).{0,4}(是多少|多少|多大)/,
  /(能|可以|能够).{0,3}(治|治疗|医治|治好|治愈|根治).{0,4}(吗|么|嘛)/,
  /(我|最近|老是|总是|经常).{0,6}(失眠|头痛|头晕|咳嗽|胃痛|胃酸|腹泻|便秘|心慌|胸闷|腰酸|背痛|耳鸣|脱发|过敏|湿疹|高血压|糖尿病).{0,8}(怎么办|咋办|怎么调理|如何治|吃什么)/,
]

export function shouldBlock(query: string): GuardResult {
  const q = (query ?? '').trim()
  if (!q) return { blocked: false, refusal: '' }
  for (const re of BLOCK_PATTERNS) {
    if (re.test(q)) return { blocked: true, refusal: REFUSAL_TEXT }
  }
  return { blocked: false, refusal: '' }
}

const DOSAGE_PATTERN = /(\d+(?:\.\d+)?)\s*(g|克|mg|ml|毫升|钱|两|粒|片|帖|贴|剂|枚|寸|分(?!钟鐘))(?![a-z])/gi
const PRESCRIPTION_PATTERNS: RegExp[] = [
  /建议.{0,8}(服用|用药|口服|煎服|水煎服)/g,
  /推荐.{0,8}(处方|方剂|药方|用药)/g,
  /(每日|每天|每天早晚饭后|分[二两]次|一次).{0,6}\d+\s*(g|克|mg|ml|毫升|钱|两|粒|片|剂)/g,
]

export const DOSAGE_SCRUB_TEXT = '（该内容涉及用药建议，已依合规要求隐藏，请咨询执业医师）'

export function sanitizeOutput(text: string): { text: string; scrubbed: boolean } {
  let out = text ?? ''
  let scrubbed = false

  if (DOSAGE_PATTERN.test(out)) {
    DOSAGE_PATTERN.lastIndex = 0
    out = out.replace(DOSAGE_PATTERN, DOSAGE_SCRUB_TEXT)
    scrubbed = true
  }
  for (const re of PRESCRIPTION_PATTERNS) {
    re.lastIndex = 0
    if (re.test(out)) {
      re.lastIndex = 0
      out = out.replace(re, DOSAGE_SCRUB_TEXT)
      scrubbed = true
    }
  }
  return { text: out, scrubbed }
}
