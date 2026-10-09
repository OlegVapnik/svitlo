export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    override message: string,
    public details?: any
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export function createErrorResponse(error: AppError | Error) {
  if (error instanceof AppError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        details: error.details
      }
    };
  }
  return {
    error: {
      code: 'INTERNAL_SERVER_ERROR',
      message: 'An unexpected error occurred',
      details: process.env['NODE_ENV'] === 'development' ? error.message : undefined
    }
  };
}
