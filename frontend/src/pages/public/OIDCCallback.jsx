import { useEffect, useState } from "preact/hooks";
import { Navigate } from "@tanstack/react-router";
import { useAuthState } from "@/state/useAuthState";

const OIDCCallback = () => {
  const [error, setError] = useState(null);
  const { handleOIDCCallback, user } = useAuthState();

  useEffect(() => {
    const processCallback = async () => {
      try {
        // Get the query string from the URL
        const searchParams = window.location.search;
        
        // Handle the OIDC callback
        await handleOIDCCallback(searchParams);
      } catch (err) {
        console.error("OIDC callback error:", err);
        setError(err.message || "Authentication failed");
      }
    };

    processCallback();
  }, [handleOIDCCallback]);

  // If authenticated successfully, redirect to home
  if (user) {
    return <Navigate to="/" replace />;
  }

  // Show error if authentication failed
  if (error) {
    return (
      <div className="bg-theme-canvas flex min-h-screen items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="border-theme-surface bg-theme-canvas-alt rounded-lg border p-8 shadow-lg">
            <h1 className="text-theme-text mb-4 text-center text-2xl font-bold">
              Authentication Failed
            </h1>
            <div className="bg-theme-red/10 text-theme-red rounded-md p-3 text-sm mb-4">
              {error}
            </div>
            <a
              href="/login"
              className="text-theme-blue block text-center text-sm hover:underline">
              Return to login
            </a>
          </div>
        </div>
      </div>
    );
  }

  // Show loading state while processing
  return (
    <div className="bg-theme-canvas flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="border-theme-surface bg-theme-canvas-alt rounded-lg border p-8 shadow-lg">
          <h1 className="text-theme-text mb-6 text-center text-2xl font-bold">
            Authenticating...
          </h1>
          <div className="text-theme-text-muted text-center">
            Please wait while we complete your sign in.
          </div>
        </div>
      </div>
    </div>
  );
};

export default OIDCCallback;
