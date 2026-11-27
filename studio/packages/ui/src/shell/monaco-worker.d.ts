declare module "*?worker" {
  const WorkerFactory: new (options?: { name?: string }) => Worker;
  export default WorkerFactory;
}
