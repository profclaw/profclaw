import { useEffect, useCallback, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/core/api/client";

interface TaskEvent {
  taskId: string;
  task: {
    id: string;
    title: string;
    status: string;
    priority: number;
    source: string;
    assignedAgent?: string;
    createdAt: string;
    startedAt?: string;
    completedAt?: string;
  };
  result?: {
    success: boolean;
    error?: string;
  };
  progress?: number;
  timestamp: string;
}

const API_BASE = "http://localhost:3000";

export function useEventStream() {
  const queryClient = useQueryClient();
  const eventSourceRef = useRef<EventSource | null>(null);
  const reconnectTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(
    null,
  );
  const notificationPrefsRef = useRef({ taskComplete: true, taskFailed: true, browserNotifications: false });

  const { data: settingsData } = useQuery({
    queryKey: ["settings"],
    queryFn: () => api.settings.get(),
    staleTime: 30000,
  });

  useEffect(() => {
    const prefs = settingsData?.settings?.notifications;
    notificationPrefsRef.current = {
      taskComplete: prefs?.taskComplete ?? true,
      taskFailed: prefs?.taskFailed ?? true,
      browserNotifications: prefs?.browserNotifications ?? false,
    };
  }, [settingsData]);

  const connect = useCallback(() => {
    // Don't create multiple connections
    if (eventSourceRef.current?.readyState === EventSource.OPEN) {
      return;
    }

    const eventSource = new EventSource(`${API_BASE}/api/events`);
    eventSourceRef.current = eventSource;

    eventSource.addEventListener("connected", (event) => {
      const data = JSON.parse(event.data);
      console.log("[SSE] Connected:", data.message);
    });

    eventSource.addEventListener("ping", () => {
      // Keep-alive, no action needed
    });

    eventSource.addEventListener("task:created", (event) => {
      const data: TaskEvent = JSON.parse(event.data);
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      toast.info(`New task: ${data.task.title}`);
    });

    eventSource.addEventListener("task:started", (event) => {
      const data: TaskEvent = JSON.parse(event.data);
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["tasks", data.taskId] });
    });

    eventSource.addEventListener("task:completed", (event) => {
      const data: TaskEvent = JSON.parse(event.data);
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["tasks", data.taskId] });
      queryClient.invalidateQueries({ queryKey: ["summaries"] });
      if (notificationPrefsRef.current.taskComplete) {
        toast.success(`Task completed: ${data.task.title}`);
        if (notificationPrefsRef.current.browserNotifications && Notification.permission === 'granted') {
          new Notification('Task Completed', { body: data.task.title });
        }
      }
    });

    eventSource.addEventListener("task:failed", (event) => {
      const data: TaskEvent = JSON.parse(event.data);
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["tasks", data.taskId] });
      queryClient.invalidateQueries({ queryKey: ["dlq"] });
      if (notificationPrefsRef.current.taskFailed) {
        toast.error(`Task failed: ${data.task.title}`, {
          description: data.result?.error,
        });
        if (notificationPrefsRef.current.browserNotifications && Notification.permission === 'granted') {
          new Notification('Task Failed', { body: `${data.task.title}${data.result?.error ? ': ' + data.result.error : ''}` });
        }
      }
    });

    eventSource.addEventListener("task:progress", (event) => {
      const data: TaskEvent = JSON.parse(event.data);
      queryClient.invalidateQueries({ queryKey: ["tasks", data.taskId] });
    });

    eventSource.addEventListener("notification:new", () => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
    });

    eventSource.onerror = () => {
      console.log("[SSE] Connection error, will reconnect...");
      eventSource.close();
      eventSourceRef.current = null;

      // Reconnect after delay
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current);
      }
      reconnectTimeoutRef.current = setTimeout(connect, 5000);
    };
  }, [queryClient]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }
    if (eventSourceRef.current) {
      eventSourceRef.current.close();
      eventSourceRef.current = null;
    }
  }, []);

  useEffect(() => {
    connect();
    return () => disconnect();
  }, [connect, disconnect]);

  return { connect, disconnect };
}
