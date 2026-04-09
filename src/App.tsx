// src/App.tsx
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import './App.css'; // 전용 스타일 유지
import './data/sources/firebase';
import { auth } from './data/sources/firebase';
import HomePage from './presentation/pages/home/HomePage';
console.log("🔥 Firebase 연결 객체:", auth);
function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<HomePage />} />
        
        {/* <Route path="/login" element={<LoginPage />} /> */}
      </Routes>
    </BrowserRouter>
  );
}

export default App;