import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import Expired from '@/pages/Expired';
import Landing from '@/pages/Landing';
import Showcase from '@/pages/Showcase';
import StagePlaceholder from '@/pages/StagePlaceholder';

/**
 * 路由表见 PROGRESS.md 0.5。
 *
 * /quiz、/survey、/report 目前挂占位页 —— 它们存在是为了让 Stage 4 的跳转
 * 可被验证(后端把 target 推导成这三个之一),分别由 Stage 6 / 7 / 8 替换。
 *
 * Admin 路由(/admin/*)是 Stage 5,尚未挂载。
 */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/expired" element={<Expired />} />
        <Route path="/quiz" element={<StagePlaceholder route="/quiz" stage="STAGE 6" />} />
        <Route path="/survey" element={<StagePlaceholder route="/survey" stage="STAGE 7" />} />
        <Route path="/report" element={<StagePlaceholder route="/report" stage="STAGE 8" />} />
        <Route path="/_showcase" element={<Showcase />} />
        {/* 未知路径不暴露路由结构,一律当链接失效处理 */}
        <Route path="*" element={<Navigate to="/expired" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
