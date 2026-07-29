import { type ReactNode } from 'react'
import { BrowserRouter, Link, NavLink, Navigate, Route, Routes } from 'react-router-dom'
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

function navBtnClass({ isActive }: { isActive: boolean }): string {
  return isActive ? 'app__navBtn is-active' : 'app__navBtn'
}

function Nav() {
  const { isLoggedIn, isAdmin, logout } = useAuth()
  return (
    <header className="app__header">
      <Link to="/" className="app__title">
        中医经典学习 · 在线版
      </Link>
      <nav className="app__nav">
        <NavLink to="/" end className={navBtnClass}>
          书库
        </NavLink>
        <NavLink to="/search" className={navBtnClass}>
          检索
        </NavLink>
        {isLoggedIn && (
          <NavLink to="/wallet" className={navBtnClass}>
            我的钱包
          </NavLink>
        )}
        {isLoggedIn && (
          <NavLink to="/chat" className={navBtnClass}>
            AI 问答
          </NavLink>
        )}
        {isAdmin && (
          <NavLink to="/admin" className={navBtnClass}>
            管理后台
          </NavLink>
        )}
      </nav>
      <span className="app__spacer" />
      {isLoggedIn ? (
        <button onClick={logout}>退出登录</button>
      ) : (
        <>
          <NavLink to="/login" className={navBtnClass}>
            登录
          </NavLink>
          <NavLink to="/register" className={navBtnClass}>
            注册
          </NavLink>
        </>
      )}
    </header>
  )
}

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter>
        <div className="app">
          <Nav />
          <main className="app__main">
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
          </main>
        </div>
      </BrowserRouter>
    </AuthProvider>
  )
}
