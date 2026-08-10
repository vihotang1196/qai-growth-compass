import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import AdminLayout from '@/pages/admin/AdminLayout';
import Expired from '@/pages/Expired';
import Landing from '@/pages/Landing';
import Quiz from '@/pages/Quiz';
import Survey from '@/pages/Survey';
import Report from '@/pages/Report';
import Showcase from '@/pages/Showcase';
import ShareCard from '@/pages/ShareCard';
import PublicShell from '@/components/PublicShell';

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
      <AppRoutes />
    </BrowserRouter>
  );
}

/**
 * 路由表本体 —— **与 BrowserRouter 分开导出,为的是能在测试里挂到 MemoryRouter 上**。
 *
 * 「/share-card 上不能有任何交互元素」这条断言必须落在**真实的路由树**上:
 * 只断言 ShareCardView 的话,守不住「有人往全局布局里加了个东西」——
 * 而 EN 按钮那次正是从布局来的,卡本身一个字都没错(判断标准 4)。
 */
export function AppRoutes() {
  return (
      <Routes>
        {/*
          人面向的页面套 PublicShell(语言切换等全局 UI 都在那一层)。
          **默认不带 chrome,要的人显式套进来** —— 见 PublicShell 的注释:
          以后往那一层加页脚 / toast,都不可能漏到 /share-card 上。
        */}
        <Route element={<PublicShell />}>
          <Route path="/" element={<Landing />} />
          <Route path="/expired" element={<Expired />} />
          <Route path="/quiz" element={<Quiz />} />
          <Route path="/survey" element={<Survey />} />
          <Route path="/report" element={<Report />} />
        </Route>
        {/*
          截图器专用,不给人访问 —— 与 /report 同样靠渲染令牌取数,没令牌就是空白。
          **刻意在 PublicShell 之外**:截图截的是整个元素,DOM 里有什么就会进图,
          而一张带 UI 控件的图看起来像截屏,不像品牌物料。
        */}
        <Route path="/share-card" element={<ShareCard />} />
        {/* 后台。守卫在 AdminLayout 里,而那一层只是 UX —— 真正的拦阻在
            assessment-admin 中(每次验 JWT + 查允许名单)。Stage 10 的其余四个模块
            会挂在 /admin 之下 */}
        <Route path="/admin" element={<AdminLayout />} />
        <Route path="/_showcase" element={<Showcase />} />
        {/* 未知路径不暴露路由结构,一律当链接失效处理 */}
        <Route path="*" element={<Navigate to="/expired" replace />} />
      </Routes>
  );
}
