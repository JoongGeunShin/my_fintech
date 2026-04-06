// src/App.tsx
import { BrowserRouter, Route, Routes } from 'react-router-dom';
import './App.css'; // 전용 스타일 유지
import HomePage from './presentation/pages/home/HomePage';

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