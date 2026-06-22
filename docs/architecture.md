# 项目架构设计 (Architecture Design)

luoleiorg-x 采用了非常前沿的 **Edge Serverless + Next.js Server Components** 架构，完全运行在 Cloudflare 生态之内。

## 核心系统架构图

```mermaid
graph TD
    %% Define Styles
    classDef edge fill:#F38020,stroke:#fff,stroke-width:2px,color:#fff;
    classDef user fill:#3B82F6,stroke:#fff,stroke-width:2px,color:#fff;
    classDef storage fill:#0051C3,stroke:#fff,stroke-width:2px,color:#fff;
    classDef analytics fill:#8B5CF6,stroke:#fff,stroke-width:2px,color:#fff;
    classDef framework stroke:#333,stroke-width:2px,stroke-dasharray: 5 5;

    %% Nodes
    Client((互联网访客)):::user
    
    subgraph CF_Network [Cloudflare 全球边缘网络]
        Router{Cloudflare Worker<br/>请求分发}:::edge
        
        subgraph App_Layer [Vinext 框架层]
            RSC[React Server Components<br/>SSR 直出页面]
            API[Next.js API Routes<br/>接口服务]
        end

        Assets[(CF Assets<br/>JS/CSS/字体)]:::storage
        ImageBinding[CF Images Binding<br/>图片动态优化]:::edge
        KV[(Cloudflare KV<br/>全局边缘缓存)]:::storage
    end

    Umami[Umami 统计平台<br/>部署在私服]:::analytics

    %% Relationships
    Client <-->|HTTPS 访问| Router
    
    %% Router Dispatch
    Router -->|静态资源| Assets
    Router -->|/_vinext/image| ImageBinding
    Router -->|页面与 API 请求| RSC
    Router -->|页面与 API 请求| API
    
    %% Internal Connections
    RSC -->|Markdown 静态注入| RSC
    RSC <-->|读取/写入文章缓存| KV
    API <-->|读取/写入 API 缓存| KV
    
    %% External API Calling
    API <-->|获取历史阅读量| Umami
    RSC <-->|回退时获取阅读量| Umami
    
    %% Styling Assignment
    class App_Layer framework;
```

## 数据与请求流向 (Data Flow)

1. **静态资源请求**: 请求 `/.js`、`/.css` 等静态资源会由 Worker 拦截并直接交由 `Cloudflare Assets` 响应，极速返回。
2. **图片请求**: 访问 `/_vinext/image` 时，Worker 会触发 `Cloudflare Images Binding` 进行实时的图片裁剪和优化。
3. **页面 SSR (React Server Components)**: 
   - 用户访问文章内页时，触发 `Vinext` 的 Server Component 渲染。
   - 文章的 Markdown 依靠 Vite 编译时的 `import.meta.glob` 以字符串形式硬编码打包在 Worker 代码中，省去了耗时的 FS I/O。
   - 文章阅读量优先走全局 `Cloudflare KV` (缓存键: `umami_pageviews_cache_v2`)，仅在没有有效缓存时回源到 Umami。
4. **统计数据 API (Umami)**: 
   - 依赖于第三方的自托管 Umami。
   - 使用 Edge KV 进行长达 6 小时的缓存，防止 Umami 后端被频繁扫描或 DDoS 击穿，实现真正的 Serverless Native 边缘保护。
