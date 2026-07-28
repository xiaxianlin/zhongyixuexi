import { type ReactNode } from 'react'
import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './lib/auth'
import LoginPage from './pages/LoginPage'
import RegisterPage from './pages/RegisterPage'
import LibraryPage from './pages/LibraryPage'
import BookDetailPage from './pages/BookDetailPage'
import SearchPage from './pages/SearchPage'
import WalletPage from './pages/WalletPage'
import ChatPage from './pages/ChatPage'
import AdminPage from './pages/AdminPage'

function RequireLogin({ children }: { children: ReactNode }) {
  const { isLoggedIn } = useAuth()
  if (!isLoggedIn) return <Navigate to="/login" replace />
  return <>{children}</>
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { isAdmin } = useAuth()
  if (!isAdmin) return <Navigate to="/" replace />
  return <>{children}</>
}

function Nav() {
  const { isLoggedIn, isAdmin, logout } = useAuth()
  return (
    <nav>
      <Link to="/">书库</Link>
      <Link to="/search">检索</Link>
      {isLoggedIn && <Link to="/wallet">我的钱包</Link>}
      {isLoggedIn && <Link to="/chat">AI 问答</Link>}
      {isAdmin && <Link to="/admin">管理后台</Link>}
      <span className="spacer" />
      {isLoggedIn ? (
        <button onClick={logout}>退出登录</button>
      ) : (
        <>
          <Link to="/login">登录</Link>
          <Link to="/register">注册</Link>
        </>
      )}
    </nav>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <Nav />
        <Routes>
          <Route path="/" element={<LibraryPage />} />
          <Route path="/books/:bookId" element={<BookDetailPage />} />
          <Route path="/search" element={<SearchPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
          <Route
            path="/wallet"
            element={
              <RequireLogin>
                <WalletPage />
              </RequireLogin>
            }
          />
          <Route
            path="/chat"
            element={
              <RequireLogin>
                <ChatPage />
              </RequireLogin>
            }
          />
          <Route
            path="/admin"
            element={
              <RequireAdmin>
                <AdminPage />
              </RequireAdmin>
            }
          />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  )
}
