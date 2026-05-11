// src/App.tsx
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import './App.css';
import './data/sources/firebase';
import { auth } from './data/sources/firebase';
import HomePage from './presentation/pages/home/HomePage';
import TradingPage from './presentation/pages/trading/TradingPage';
console.log("🔥 Firebase 연결 객체:", auth);
function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/"        element={<HomePage />} />
        <Route path="/trading" element={<TradingPage />} />
      </Routes>
    </BrowserRouter>
  );
}

export default App;