import fp from 'fastify-plugin';
import swagger from '@fastify/swagger';
import swaggerUI from '@fastify/swagger-ui';

export default fp(async (fastify) => {
  await fastify.register(swagger, {
    openapi: {
      info: { title: 'EnergyMonitor API', version: '0.1.0' },
    }
  });
  await fastify.register(swaggerUI, {
    routePrefix: '/docs',
  });
});
