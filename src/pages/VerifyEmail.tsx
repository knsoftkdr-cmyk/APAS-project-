import { useEffect } from "react";
import { useNavigate } from "react-router-dom";

const VerifyEmail = () => {
  const navigate = useNavigate();

  useEffect(() => {
    // Email verification is no longer required for teacher/admin registration
    // Redirect to dashboard if user is logged in, otherwise to login
    const redirectDelay = setTimeout(() => {
      navigate("/dashboard", { replace: true });
    }, 500);

    return () => clearTimeout(redirectDelay);
  }, [navigate]);

  return (
    <div className="min-h-screen flex items-center justify-center">
      <div className="text-center">
        <p className="text-lg text-gray-600">Redirecting...</p>
      </div>
    </div>
  );
};

export default VerifyEmail;
