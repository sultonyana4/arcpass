import { registerWallet, lookupWallet } from '../services/wallet.service.js'
import { WalletNotFoundError } from '../lib/errors.js'

const registerSchema = {
  body: {
    type: 'object',
    required: ['walletAddress'],
    properties: {
      walletAddress: { type: 'string' },
    },
    additionalProperties: false,
  },
}

const lookupSchema = {
  params: {
    type: 'object',
    required: ['address'],
    properties: {
      address: { type: 'string' },
    },
  },
}

function formatWalletResponse(wallet) {
  return {
    id: wallet.id,
    walletAddress: wallet.walletAddress,
    firstSeenAt: wallet.firstSeenAt.toISOString(),
    lastSeenAt: wallet.lastSeenAt.toISOString(),
    sponsorshipCount: wallet.sponsorshipCount,
    isBlocked: wallet.isBlocked,
  }
}

export default async function walletRoutes(fastify, opts) {
  fastify.post('/register', { schema: registerSchema }, async (request, reply) => {
    const { walletAddress } = request.body
    const { wallet, isNew } = await registerWallet(walletAddress)
    const statusCode = isNew ? 201 : 200
    return reply.status(statusCode).send(formatWalletResponse(wallet))
  })

  fastify.get('/:address', { schema: lookupSchema }, async (request, reply) => {
    const { address } = request.params
    const wallet = await lookupWallet(address)

    if (!wallet) {
      throw new WalletNotFoundError('Wallet not found')
    }

    return reply.status(200).send(formatWalletResponse(wallet))
  })
}
