import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import AdminLayout from '@/pages/admin/AdminLayout';
import Expired from '@/pages/Expired';
import Landing from '@/pages/Landing';
import Quiz from '@/pages/Quiz';
import Survey from '@/pages/Survey';
import Report from '@/pages/Report';
import Showcase from '@/pages/Showcase';
import ShareCard from '@/pages/ShareCard';
import LanguageToggle from '@/components/LanguageToggle';

/**
 * 路由表见 PROGRESS.md 0.5。
 *
 * /report 是 Stage 8,已挂载;之前占位页是为了让 Stage 4 的跳转
 * 可被验证(后端把 target 推导成这三个之一),分别由 Stage 6 / 7 / 8 替换。
 *
 * /quiz 是 Stage 6;/survey 是 Stage 7;/admin 是 Stage 5,均已挂载。
 */
export default function App() {
  return (
    <BrowserRouter>
      {/* 右上角常驻语言切换。在 Routes 之外,一处渲染,浮在所有页面上;
          自身在 /admin 与 /_showcase 隐藏(见组件) */}
      <LanguageToggle />
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/expired" element={<Expired />} />
        <Route path="/quiz" element={<Quiz />} />
        <Route path="/survey" element={<Survey />} />
        <Route path="/report" element={<Report />} />
        {/* 截图器专用,不给人访问 —— 与 /report 同样靠渲染令牌取数,没令牌就是空白 */}
        <Route path="/share-card" element={<ShareCard />} />
        {/* 后台。守卫在 AdminLayout 里,而那一层只是 UX —— 真正的拦阻在
            assessment-admin 中(每次验 JWT + 查允许名单)。Stage 10 的其余四个模块
            会挂在 /admin 之下 */}
        <Route path="/admin" element={<AdminLayout />} />
        <Route path="/_showcase" element={<Showcase />} />
        {/* 未知路径不暴露路由结构,一律当链接失效处理 */}
        <Route path="*" element={<Navigate to="/expired" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
