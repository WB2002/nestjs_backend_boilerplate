import { LoggerContext } from './logger.context';

export function Trace(): MethodDecorator {
  return (
    target: any,
    propertyKey: string | symbol,
    descriptor: PropertyDescriptor,
  ) => {
    const originalMethod = descriptor.value;
    const className = target.constructor.name;

    descriptor.value = function (...args: any[]) {
      return LoggerContext.run(
        {
          ...LoggerContext.get(),
          context: className,
          method: propertyKey.toString(),
        },
        () => originalMethod.apply(this, args),
      );
    };

    return descriptor;
  };
}
