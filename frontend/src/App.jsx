import { Routes, Route, Navigate } from 'react-router-dom'
import Login from './pages/Login'
import LandingPage from './pages/LandingPage'
import Checkout from './pages/Checkout'
import VerificarEmail from './pages/VerificarEmail'
import Dashboard from './pages/Dashboard'
import Campanhas from './pages/Campanhas'
import Contatos from './pages/Contatos'
import Sessoes from './pages/Sessoes'
import Grupos from './pages/Grupos'
import Funil from './pages/Funil'
import Aquecimento from './pages/Aquecimento'
import Configuracoes from './pages/Configuracoes'
import Admin from './pages/Admin'
import Layout from './components/Layout'

function PrivateRoute({ children }) {
  const token = localStorage.getItem('access_token')
  return token ? children : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <Routes>
      {/* Public routes */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/checkout" element={<Checkout />} />
      <Route path="/verificar-email" element={<VerificarEmail />} />
      <Route path="/login" element={<Login />} />

      {/* Protected app routes */}
      <Route
        element={
          <PrivateRoute>
            <Layout />
          </PrivateRoute>
        }
      >
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/campanhas" element={<Campanhas />} />
        <Route path="/contatos" element={<Contatos />} />
        <Route path="/sessoes" element={<Sessoes />} />
        <Route path="/grupos" element={<Grupos />} />
        <Route path="/funil" element={<Funil />} />
        <Route path="/aquecimento" element={<Aquecimento />} />
        <Route path="/configuracoes" element={<Configuracoes />} />
        <Route path="/admin" element={<Admin />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
