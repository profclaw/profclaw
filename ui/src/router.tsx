import { type ReactNode, lazy, Suspense } from 'react';
import { createBrowserRouter, RouterProvider, Navigate } from 'react-router-dom';
import { RootLayout } from '@/layouts/RootLayout';
import { PageSkeleton } from '@/components/shared/PageSkeleton';

// Eager imports - auth and setup pages must load immediately
import { LoginPage, SignupPage, AccessKeyPage, AuthGuard, GuestGuard } from '@/features/auth';
import { SetupWizard } from '@/features/setup/views/SetupWizard';
import { OOBEWizard } from '@/features/setup/views/OOBEWizard';
import { OnboardingPage } from '@/features/setup/views/OnboardingPage';

// Lazy imports - heavy feature pages split into separate chunks
const AnalyticsDashboard = lazy(() =>
  import('@/features/dashboard/views/AnalyticsDashboard').then(m => ({ default: m.AnalyticsDashboard }))
);
const TaskList = lazy(() =>
  import('@/features/tasks/views/TaskList').then(m => ({ default: m.TaskList }))
);
const TaskDetail = lazy(() =>
  import('@/features/tasks/views/TaskDetail').then(m => ({ default: m.TaskDetail }))
);
const SummaryList = lazy(() =>
  import('@/features/summaries/views/SummaryList').then(m => ({ default: m.SummaryList }))
);
const SummaryDetail = lazy(() =>
  import('@/features/summaries/views/SummaryDetail').then(m => ({ default: m.SummaryDetail }))
);
const AgentList = lazy(() =>
  import('@/features/agents/views/AgentList').then(m => ({ default: m.AgentList }))
);
const Settings = lazy(() =>
  import('@/features/settings/views/Settings').then(m => ({ default: m.Settings }))
);
const CostsDashboard = lazy(() =>
  import('@/features/costs/views/CostsDashboard').then(m => ({ default: m.CostsDashboard }))
);
const WebhookStatus = lazy(() =>
  import('@/features/webhooks/index').then(m => ({ default: m.WebhookStatus }))
);
const DLQDashboard = lazy(() =>
  import('@/features/dlq/index').then(m => ({ default: m.DLQDashboard }))
);
const GatewayDashboard = lazy(() =>
  import('@/features/gateway/index').then(m => ({ default: m.GatewayDashboard }))
);
const TicketList = lazy(() =>
  import('@/features/tickets/views/TicketList').then(m => ({ default: m.TicketList }))
);
const TicketDetail = lazy(() =>
  import('@/features/tickets/views/TicketDetail').then(m => ({ default: m.TicketDetail }))
);
const TicketBoard = lazy(() =>
  import('@/features/tickets/views/TicketBoard').then(m => ({ default: m.TicketBoard }))
);
const ChatView = lazy(() =>
  import('@/features/chat/views/ChatView').then(m => ({ default: m.ChatView }))
);
const ProjectList = lazy(() =>
  import('@/features/projects/views/ProjectList').then(m => ({ default: m.ProjectList }))
);
const ProjectDetail = lazy(() =>
  import('@/features/projects/views/ProjectDetail').then(m => ({ default: m.ProjectDetail }))
);
const CronDashboard = lazy(() =>
  import('@/features/cron/index').then(m => ({ default: m.CronDashboard }))
);
const ActivityView = lazy(() =>
  import('@/features/notifications/views/ActivityView').then(m => ({ default: m.ActivityView }))
);
const UserManagement = lazy(() =>
  import('@/features/admin/views/UserManagement').then(m => ({ default: m.UserManagement }))
);
const InviteCodeManagement = lazy(() =>
  import('@/features/admin/views/InviteCodeManagement').then(m => ({ default: m.InviteCodeManagement }))
);
const PrivacyPolicy = lazy(() =>
  import('@/features/legal/index').then(m => ({ default: m.PrivacyPolicy }))
);
const TermsOfService = lazy(() =>
  import('@/features/legal/index').then(m => ({ default: m.TermsOfService }))
);

function Lazy({ children }: { children: ReactNode }) {
  return <Suspense fallback={<PageSkeleton />}>{children}</Suspense>;
}

const router = createBrowserRouter([
  // Auth routes (guest only - redirects to / if logged in)
  {
    path: '/login',
    element: <GuestGuard><LoginPage /></GuestGuard>,
  },
  {
    path: '/signup',
    element: <GuestGuard><SignupPage /></GuestGuard>,
  },
  {
    path: '/access-key',
    element: <GuestGuard><AccessKeyPage /></GuestGuard>,
  },
  // OOBE wizard (public - for first-time local setup)
  {
    path: '/oobe',
    element: <OOBEWizard />,
  },
  // Setup wizard (public - for first-time configuration)
  {
    path: '/setup',
    element: <SetupWizard />,
  },
  // Legal pages (public - no auth required)
  {
    path: '/privacy',
    element: <Lazy><PrivacyPolicy /></Lazy>,
  },
  {
    path: '/terms',
    element: <Lazy><TermsOfService /></Lazy>,
  },
  // Onboarding (for new users after signup)
  {
    path: '/onboarding',
    element: <AuthGuard><Lazy><OnboardingPage /></Lazy></AuthGuard>,
  },
  // Protected app routes (redirects to /login if not authenticated)
  {
    path: '/',
    element: <AuthGuard><RootLayout><Lazy><ChatView /></Lazy></RootLayout></AuthGuard>,
  },
  {
    path: '/tasks',
    element: <AuthGuard><RootLayout><Lazy><TaskList /></Lazy></RootLayout></AuthGuard>,
  },
  {
    path: '/tasks/:id',
    element: <AuthGuard><RootLayout><Lazy><TaskDetail /></Lazy></RootLayout></AuthGuard>,
  },
  {
    path: '/summaries',
    element: <AuthGuard><RootLayout><Lazy><SummaryList /></Lazy></RootLayout></AuthGuard>,
  },
  {
    path: '/summaries/:id',
    element: <AuthGuard><RootLayout><Lazy><SummaryDetail /></Lazy></RootLayout></AuthGuard>,
  },
  {
    path: '/agents',
    element: <AuthGuard><RootLayout><Lazy><AgentList /></Lazy></RootLayout></AuthGuard>,
  },
  {
    path: '/costs',
    element: <AuthGuard><RootLayout><Lazy><CostsDashboard /></Lazy></RootLayout></AuthGuard>,
  },
  {
    path: '/settings',
    element: <AuthGuard><RootLayout><Lazy><Settings /></Lazy></RootLayout></AuthGuard>,
  },
  {
    path: '/settings/:section',
    element: <AuthGuard><RootLayout><Lazy><Settings /></Lazy></RootLayout></AuthGuard>,
  },
  {
    path: '/webhooks',
    element: <AuthGuard><RootLayout><Lazy><WebhookStatus /></Lazy></RootLayout></AuthGuard>,
  },
  {
    path: '/failed',
    element: <AuthGuard><RootLayout><Lazy><DLQDashboard /></Lazy></RootLayout></AuthGuard>,
  },
  {
    path: '/gateway',
    element: <AuthGuard><RootLayout><Lazy><GatewayDashboard /></Lazy></RootLayout></AuthGuard>,
  },
  {
    path: '/tickets',
    element: <AuthGuard><RootLayout><Lazy><TicketList /></Lazy></RootLayout></AuthGuard>,
  },
  {
    path: '/tickets/board',
    element: <AuthGuard><RootLayout><Lazy><TicketBoard /></Lazy></RootLayout></AuthGuard>,
  },
  {
    path: '/tickets/:id',
    element: <AuthGuard><RootLayout><Lazy><TicketDetail /></Lazy></RootLayout></AuthGuard>,
  },
  {
    path: '/chat',
    element: <Navigate to="/" replace />,
  },
  {
    path: '/analytics',
    element: <AuthGuard><RootLayout><Lazy><AnalyticsDashboard /></Lazy></RootLayout></AuthGuard>,
  },
  {
    path: '/projects',
    element: <AuthGuard><RootLayout><Lazy><ProjectList /></Lazy></RootLayout></AuthGuard>,
  },
  {
    path: '/projects/:id',
    element: <AuthGuard><RootLayout><Lazy><ProjectDetail /></Lazy></RootLayout></AuthGuard>,
  },
  {
    path: '/cron',
    element: <AuthGuard><RootLayout><Lazy><CronDashboard /></Lazy></RootLayout></AuthGuard>,
  },
  {
    path: '/activity',
    element: <AuthGuard><RootLayout><Lazy><ActivityView /></Lazy></RootLayout></AuthGuard>,
  },
  // Admin routes
  {
    path: '/admin/users',
    element: <AuthGuard><RootLayout><Lazy><UserManagement /></Lazy></RootLayout></AuthGuard>,
  },
  {
    path: '/admin/invite-codes',
    element: <AuthGuard><RootLayout><Lazy><InviteCodeManagement /></Lazy></RootLayout></AuthGuard>,
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
