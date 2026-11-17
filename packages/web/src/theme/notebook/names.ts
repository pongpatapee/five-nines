/**
 * The real-world names the notebook gives each component kind: one consistent AWS family, plus Stripe for the outside
 * payment service. The generic concept always stays beside the product, because the concept is what the game teaches;
 * the product is what the player will meet at work. Copy that explains a concept keeps the concept's words.
 */
import type { ComponentName, NamedKind } from '../contract.ts';

export const COMPONENT_NAMES: Readonly<Record<NamedKind, ComponentName>> = {
  clients: {
    product: 'Users',
    concept: 'clients',
    phrase: 'users',
    about: 'Browsers and phones out on the internet: the traffic every design has to serve.',
  },
  appServer: {
    product: 'EC2',
    concept: 'app server',
    phrase: 'EC2 app server',
    about: 'On AWS, app servers are usually EC2 instances: virtual machines rented by the hour, sized by vCPUs and memory.',
  },
  loadBalancer: {
    product: 'ALB',
    concept: 'load balancer',
    phrase: 'ALB load balancer',
    about: "On AWS, this is Elastic Load Balancing's Application Load Balancer (ALB), which health-checks the instances behind it.",
  },
  cache: {
    product: 'ElastiCache',
    concept: 'Redis cache',
    phrase: 'ElastiCache Redis cache',
    about: 'On AWS, a cache like this is ElastiCache running Redis: an in-memory key-value store, rented by node size.',
  },
  database: {
    product: 'RDS',
    concept: 'Postgres database',
    phrase: 'RDS Postgres database',
    about: 'On AWS, this is RDS running Postgres: a managed relational database on a machine you pick the size of.',
  },
  readReplicas: {
    product: 'RDS read replicas',
    concept: 'read-only Postgres copies',
    phrase: 'RDS read replicas',
    about: 'On AWS, RDS read replicas: copies of the primary that Postgres keeps in step from its write log.',
  },
  shards: {
    product: 'RDS shards',
    concept: 'sharded Postgres',
    phrase: 'RDS Postgres shards',
    about: 'On AWS, sharding usually means several RDS Postgres primaries, with the app choosing the right one for each key.',
  },
  queue: {
    product: 'SQS',
    concept: 'queue + workers',
    phrase: 'SQS queue',
    about: 'On AWS, this is SQS (Simple Queue Service), with a fleet of small worker instances polling it for messages.',
  },
  paymentProvider: {
    product: 'Stripe',
    concept: 'payment provider',
    phrase: 'Stripe payment provider',
    about: "Not AWS: a payment provider like Stripe, someone else's API that charges the cards and rate-limits your calls.",
  },
};
