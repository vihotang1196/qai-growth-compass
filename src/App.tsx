import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Showcase from '@/pages/Showcase';

/**
 * Stage 1 只挂组件展示页。
 * 客户端路由(/quiz /survey /report)与后台路由在各自阶段接入,见 PROGRESS.md 0.5。
 */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/_showcase" element={<Showcase />} />
        <Route path="*" element={<Navigate to="/_showcase" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
