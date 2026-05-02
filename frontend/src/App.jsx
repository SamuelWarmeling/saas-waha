import { Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import Login from './pages/Login'
import LandingPage from './pages/LandingPage'
import Checkout from './pages/Checkout'
import VerificarEmail from './pages/VerificarEmail'
import PagamentoSucesso from './pages/PagamentoSucesso'
import Dashboard from './pages/Dashboard'
import Campanhas from './pages/Campanhas'
import Contatos from './pages/Contatos'
import Sessoes from './pages/Sessoes'
import Grupos from './pages/Grupos'
import Funil from './pages/Funil'
import Aquecimento from './pages/Aquecimento'
import Configuracoes from './pages/Configuracoes'
import Extracao from './pages/Extracao'
import Admin from './pages/Admin'
import Layout from './components/Layout'

function PrivateRoute({ children }) {
  const token = localStorage.getItem('access_token')
  return token ? children : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <>
    <Toaster position="top-right" toastOptions={{ style: { background: '#1f2937', color: '#f9fafb', border: '1px solid #374151' } }} />
    <Routes>
      {/* Public routes */}
      <Route path="/" element={<LandingPage />} />
      <Route path="/checkout" element={<Checkout />} />
      <Route path="/verificar-email" element={<VerificarEmail />} />
      <Route path="/pagamento/sucesso" element={<PagamentoSucesso />} />
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
        <Route path="/extracao" element={<Extracao />} />
        <Route path="/configuracoes" element={<Configuracoes />} />
        <Route path="/admin" element={<Admin />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
    </>
  )
}
