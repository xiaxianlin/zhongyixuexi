import { useEffect, useState } from 'react'
import { apiFetch } from '../lib/api'

interface Adjustment {
  id: string
  deltaTokens: number
  amountCny: number | null
  note: string | null
  createdAt: string
}

interface WalletInfo {
  balance: number
  adjustments: Adjustment[]
}

export default function WalletPage() {
  const [wallet, setWallet] = useState<WalletInfo | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiFetch<WalletInfo>('/wallet')
      .then(setWallet)
      .catch((err) => setError(err instanceof Error ? err.message : '加载失败'))
  }, [])

  if (error) return <p className="error">{error}</p>
  if (!wallet) return <p>加载中…</p>

  return (
    <div>
      <h1>我的钱包</h1>
      <p>
        余额：<strong>{wallet.balance.toLocaleString()}</strong> token
      </p>
      <p className="hint">
        充值方式：转账给运营方后，由管理员在后台手动为你的账号充值，系统不接支付渠道。
      </p>
      <h2>流水</h2>
      {wallet.adjustments.length === 0 ? (
        <p className="hint">暂无记录。</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>变动</th>
              <th>备注</th>
            </tr>
          </thead>
          <tbody>
            {wallet.adjustments.map((a) => (
              <tr key={a.id}>
                <td>{new Date(a.createdAt).toLocaleString()}</td>
                <td>{a.deltaTokens > 0 ? `+${a.deltaTokens}` : a.deltaTokens}</td>
                <td>{a.note ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}
