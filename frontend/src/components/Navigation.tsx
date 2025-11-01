import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../lib/authStore';
import { logout as apiLogout } from '../lib/api';
import toast from 'react-hot-toast';
import { Menu } from '@headlessui/react';

export default function Navigation() {
  const navigate = useNavigate();
  const { user, logout } = useAuthStore();

  const handleLogout = async () => {
    try {
      await apiLogout();
      logout();
      toast.success('Logged out successfully');
      navigate('/login');
    } catch (error) {
      console.error('Logout error:', error);
      // Still logout on frontend even if backend fails
      logout();
      navigate('/login');
    }
  };

  if (!user) {
    return null;
  }

  return (
    <nav className="bg-white border-b border-gray-200 shadow-sm">
      <div className="container mx-auto px-4">
        <div className="flex items-center justify-between h-16">
          {/* Logo */}
          <Link to="/bookcase" className="flex items-center gap-2">
            <span className="text-2xl font-bold text-gray-900">
              Vivid<span className="text-indigo-600">Pages</span>
            </span>
          </Link>

          {/* Navigation Links */}
          <div className="hidden md:flex items-center gap-6">
            <Link
              to="/bookcase"
              className="text-gray-700 hover:text-indigo-600 font-medium transition"
            >
              Bookcase
            </Link>
            <Link
              to="/settings"
              className="text-gray-700 hover:text-indigo-600 font-medium transition"
            >
              Settings
            </Link>
          </div>

          {/* User Menu */}
          <Menu as="div" className="relative">
            <Menu.Button className="flex items-center gap-3 hover:opacity-80 transition">
              {user.avatarUrl ? (
                <img
                  src={user.avatarUrl}
                  alt={user.fullName || user.email}
                  className="w-10 h-10 rounded-full border-2 border-gray-200"
                />
              ) : (
                <div className="w-10 h-10 rounded-full bg-indigo-600 text-white flex items-center justify-center font-semibold border-2 border-gray-200">
                  {user.email.charAt(0).toUpperCase()}
                </div>
              )}
              <span className="hidden md:block text-sm font-medium text-gray-700">
                {user.fullName || user.email}
              </span>
            </Menu.Button>

            <Menu.Items className="absolute right-0 mt-2 w-56 origin-top-right bg-white border border-gray-200 rounded-lg shadow-lg focus:outline-none">
              <div className="px-4 py-3 border-b border-gray-200">
                <p className="text-sm font-medium text-gray-900 truncate">
                  {user.fullName || 'User'}
                </p>
                <p className="text-sm text-gray-500 truncate">{user.email}</p>
              </div>

              <div className="py-1">
                <Menu.Item>
                  {({ active }) => (
                    <Link
                      to="/settings"
                      className={`${
                        active ? 'bg-gray-100' : ''
                      } flex items-center gap-2 px-4 py-2 text-sm text-gray-700`}
                    >
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
                        />
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
                        />
                      </svg>
                      Settings
                    </Link>
                  )}
                </Menu.Item>

                <Menu.Item>
                  {({ active }) => (
                    <button
                      onClick={handleLogout}
                      className={`${
                        active ? 'bg-gray-100' : ''
                      } flex items-center gap-2 px-4 py-2 text-sm text-gray-700 w-full text-left`}
                    >
                      <svg
                        className="w-5 h-5"
                        fill="none"
                        stroke="currentColor"
                        viewBox="0 0 24 24"
                      >
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={2}
                          d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                        />
                      </svg>
                      Sign out
                    </button>
                  )}
                </Menu.Item>
              </div>
            </Menu.Items>
          </Menu>
        </div>
      </div>
    </nav>
  );
}
