// A business rejection confirms this operation made no economic change.
// Database/transport exceptions must keep the client's original operation key.
export class OperationRejectedError extends Error {
  readonly operationRejected = true;
}
