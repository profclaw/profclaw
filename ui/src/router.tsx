import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { RootLayout } from '@/layouts/RootLayout';
import { Dashboard } from '@/features/dashboard/views/Dashboard';
import { TaskList } from '@/features/tasks/views/TaskList';
import { TaskDetail } from '@/features/tasks/views/TaskDetail';
import { SummaryList } from '@/features/summaries/views/SummaryList';
import { SummaryDetail } from '@/features/summaries/views/SummaryDetail';
import { AgentList } from '@/features/agents';
import { Settings } from '@/features/settings';
import { CostsDashboard } from '@/features/costs/views/CostsDashboard';
import { WebhookStatus } from '@/features/webhooks';
import { DLQDashboard } from '@/features/dlq';
import { GatewayDashboard } from '@/features/gateway';
import { TicketList, TicketDetail, TicketBoard } from '@/features/tickets';
import { ChatView } from '@/features/chat';
import { ProjectList, ProjectDetail } from '@/features/projects';
import { CronDashboard } from '@/features/cron';
import { ActivityView } from '@/features/notifications/views/ActivityView';
import { LoginPage, SignupPage, AuthGuard, GuestGuard } from '@/features/auth';
import { SetupWizard } from '@/features/setup/views/SetupWizard';
import { OnboardingPage } from '@/features/setup/views/OnboardingPage';
import { UserManagement, InviteCodeManagement } from '@/features/admin';
import { PrivacyPolicy, TermsOfService } from '@/features/legal';

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
  // Setup wizard (public - for first-time configuration)
  {
    path: '/setup',
    element: <SetupWizard />,
  },
  // Legal pages (public - no auth required)
  {
    path: '/privacy',
    element: <PrivacyPolicy />,
  },
  {
    path: '/terms',
    element: <TermsOfService />,
  },
  // Onboarding (for new users after signup)
  {
    path: '/onboarding',
    element: <AuthGuard><OnboardingPage /></AuthGuard>,
  },
  // Protected app routes (redirects to /login if not authenticated)
  {
    path: '/',
    element: <AuthGuard><RootLayout><Dashboard /></RootLayout></AuthGuard>,
  },
  {
    path: '/tasks',
    element: <AuthGuard><RootLayout><TaskList /></RootLayout></AuthGuard>,
  },
  {
    path: '/tasks/:id',
    element: <AuthGuard><RootLayout><TaskDetail /></RootLayout></AuthGuard>,
  },
  {
    path: '/summaries',
    element: <AuthGuard><RootLayout><SummaryList /></RootLayout></AuthGuard>,
  },
  {
    path: '/summaries/:id',
    element: <AuthGuard><RootLayout><SummaryDetail /></RootLayout></AuthGuard>,
  },
  {
    path: '/agents',
    element: <AuthGuard><RootLayout><AgentList /></RootLayout></AuthGuard>,
  },
  {
    path: '/costs',
    element: <AuthGuard><RootLayout><CostsDashboard /></RootLayout></AuthGuard>,
  },
  {
    path: '/settings',
    element: <AuthGuard><RootLayout><Settings /></RootLayout></AuthGuard>,
  },
  {
    path: '/settings/:section',
    element: <AuthGuard><RootLayout><Settings /></RootLayout></AuthGuard>,
  },
  {
    path: '/webhooks',
    element: <AuthGuard><RootLayout><WebhookStatus /></RootLayout></AuthGuard>,
  },
  {
    path: '/failed',
    element: <AuthGuard><RootLayout><DLQDashboard /></RootLayout></AuthGuard>,
  },
  {
    path: '/gateway',
    element: <AuthGuard><RootLayout><GatewayDashboard /></RootLayout></AuthGuard>,
  },
  {
    path: '/tickets',
    element: <AuthGuard><RootLayout><TicketList /></RootLayout></AuthGuard>,
  },
  {
    path: '/tickets/board',
    element: <AuthGuard><RootLayout><TicketBoard /></RootLayout></AuthGuard>,
  },
  {
    path: '/tickets/:id',
    element: <AuthGuard><RootLayout><TicketDetail /></RootLayout></AuthGuard>,
  },
  {
    path: '/chat',
    element: <AuthGuard><RootLayout><ChatView /></RootLayout></AuthGuard>,
  },
  {
    path: '/projects',
    element: <AuthGuard><RootLayout><ProjectList /></RootLayout></AuthGuard>,
  },
  {
    path: '/projects/:id',
    element: <AuthGuard><RootLayout><ProjectDetail /></RootLayout></AuthGuard>,
  },
  {
    path: '/cron',
    element: <AuthGuard><RootLayout><CronDashboard /></RootLayout></AuthGuard>,
  },
  {
    path: '/activity',
    element: <AuthGuard><RootLayout><ActivityView /></RootLayout></AuthGuard>,
  },
  // Admin routes
  {
    path: '/admin/users',
    element: <AuthGuard><RootLayout><UserManagement /></RootLayout></AuthGuard>,
  },
  {
    path: '/admin/invite-codes',
    element: <AuthGuard><RootLayout><InviteCodeManagement /></RootLayout></AuthGuard>,
  },
]);

export function AppRouter() {
  return <RouterProvider router={router} />;
}
