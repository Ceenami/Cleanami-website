export interface AuthUserForm {
  success: boolean;
  data: {
    email: string;
  };
  error: {
    message: string;
  };
}
