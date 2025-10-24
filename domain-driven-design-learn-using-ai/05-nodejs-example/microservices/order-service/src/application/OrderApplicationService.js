// Order Service - Application Layer
// Demonstrates application services, use cases, and saga pattern

const { Order, Address } = require('../domain/Order');
const { DomainError, ApplicationError } = require('../../../shared/errors');

// Commands (DTOs for incoming requests)
class CreateOrderCommand {
  constructor(customerId, lineItems, shippingAddress, billingAddress = null) {
    this.customerId = customerId;
    this.lineItems = lineItems; // Array of { productId, quantity }
    this.shippingAddress = shippingAddress;
    this.billingAddress = billingAddress;
  }
}

class ConfirmOrderCommand {
  constructor(orderId) {
    this.orderId = orderId;
  }
}

class ShipOrderCommand {
  constructor(orderId, trackingNumber) {
    this.orderId = orderId;
    this.trackingNumber = trackingNumber;
  }
}

class CancelOrderCommand {
  constructor(orderId, reason = null) {
    this.orderId = orderId;
    this.reason = reason;
  }
}

// Application Services
class OrderApplicationService {
  constructor(
    orderRepository,
    customerService,
    catalogService,
    inventoryService,
    eventBus,
    logger
  ) {
    this.orderRepository = orderRepository;
    this.customerService = customerService;
    this.catalogService = catalogService;
    this.inventoryService = inventoryService;
    this.eventBus = eventBus;
    this.logger = logger;
  }

  async createOrder(command) {
    try {
      this.logger.info('Creating order', { customerId: command.customerId });

      // Validate customer exists
      const customer = await this.customerService.getCustomer(command.customerId);
      if (!customer) {
        throw new ApplicationError('Customer not found');
      }

      // Validate and enrich line items with product information
      const enrichedLineItems = await this.validateAndEnrichLineItems(command.lineItems);

      // Create domain object
      const shippingAddress = new Address(
        command.shippingAddress.street,
        command.shippingAddress.city,
        command.shippingAddress.state,
        command.shippingAddress.zipCode,
        command.shippingAddress.country
      );

      let billingAddress = null;
      if (command.billingAddress) {
        billingAddress = new Address(
          command.billingAddress.street,
          command.billingAddress.city,
          command.billingAddress.state,
          command.billingAddress.zipCode,
          command.billingAddress.country
        );
      }

      const order = Order.create(
        command.customerId,
        enrichedLineItems,
        shippingAddress,
        billingAddress
      );

      // Persist the order
      await this.orderRepository.save(order);

      // Publish domain events
      await this.publishDomainEvents(order);

      this.logger.info('Order created successfully', { 
        orderId: order.orderId,
        customerId: order.customerId,
        totalAmount: order.totalAmount.amount
      });

      return {
        orderId: order.orderId,
        status: order.status,
        totalAmount: order.totalAmount.amount,
        lineItemCount: order.getLineItemCount()
      };

    } catch (error) {
      this.logger.error('Failed to create order', { 
        error: error.message,
        customerId: command.customerId
      });
      throw error;
    }
  }

  async confirmOrder(command) {
    try {
      this.logger.info('Confirming order', { orderId: command.orderId });

      const order = await this.orderRepository.findById(command.orderId);
      if (!order) {
        throw new ApplicationError('Order not found');
      }

      // Business logic in domain
      order.confirm();

      await this.orderRepository.save(order);
      await this.publishDomainEvents(order);

      this.logger.info('Order confirmed', { orderId: order.orderId });

      return {
        orderId: order.orderId,
        status: order.status
      };

    } catch (error) {
      this.logger.error('Failed to confirm order', {
        error: error.message,
        orderId: command.orderId
      });
      throw error;
    }
  }

  async shipOrder(command) {
    try {
      this.logger.info('Shipping order', { 
        orderId: command.orderId,
        trackingNumber: command.trackingNumber
      });

      const order = await this.orderRepository.findById(command.orderId);
      if (!order) {
        throw new ApplicationError('Order not found');
      }

      order.ship(command.trackingNumber);

      await this.orderRepository.save(order);
      await this.publishDomainEvents(order);

      this.logger.info('Order shipped', { 
        orderId: order.orderId,
        trackingNumber: command.trackingNumber
      });

      return {
        orderId: order.orderId,
        status: order.status,
        trackingNumber: order.trackingNumber
      };

    } catch (error) {
      this.logger.error('Failed to ship order', {
        error: error.message,
        orderId: command.orderId
      });
      throw error;
    }
  }

  async cancelOrder(command) {
    try {
      this.logger.info('Cancelling order', { 
        orderId: command.orderId,
        reason: command.reason
      });

      const order = await this.orderRepository.findById(command.orderId);
      if (!order) {
        throw new ApplicationError('Order not found');
      }

      order.cancel(command.reason);

      await this.orderRepository.save(order);
      await this.publishDomainEvents(order);

      this.logger.info('Order cancelled', { 
        orderId: order.orderId,
        reason: command.reason
      });

      return {
        orderId: order.orderId,
        status: order.status
      };

    } catch (error) {
      this.logger.error('Failed to cancel order', {
        error: error.message,
        orderId: command.orderId
      });
      throw error;
    }
  }

  async getOrder(orderId) {
    const order = await this.orderRepository.findById(orderId);
    if (!order) {
      throw new ApplicationError('Order not found');
    }

    return order.toJSON();
  }

  async getOrdersByCustomer(customerId, page = 1, limit = 10) {
    return await this.orderRepository.findByCustomerId(customerId, page, limit);
  }

  // Private helper methods
  async validateAndEnrichLineItems(lineItems) {
    const enrichedItems = [];

    for (const item of lineItems) {
      // Validate product exists and get current price
      const product = await this.catalogService.getProduct(item.productId);
      if (!product) {
        throw new ApplicationError(`Product not found: ${item.productId}`);
      }

      // Check inventory availability
      const availability = await this.inventoryService.checkAvailability(
        item.productId,
        item.quantity
      );

      if (!availability.available) {
        throw new ApplicationError(
          `Insufficient stock for product ${item.productId}. Available: ${availability.availableQuantity}, Requested: ${item.quantity}`
        );
      }

      enrichedItems.push({
        productId: item.productId,
        quantity: item.quantity,
        unitPrice: product.price,
        productName: product.name
      });
    }

    return enrichedItems;
  }

  async publishDomainEvents(order) {
    const events = order.getDomainEvents();
    
    for (const event of events) {
      await this.eventBus.publish(event);
    }

    order.clearDomainEvents();
  }
}

// Saga for Order Processing
class OrderProcessingSaga {
  constructor(
    orderService,
    inventoryService,
    paymentService,
    sagaRepository,
    eventBus,
    logger
  ) {
    this.orderService = orderService;
    this.inventoryService = inventoryService;
    this.paymentService = paymentService;
    this.sagaRepository = sagaRepository;
    this.eventBus = eventBus;
    this.logger = logger;
  }

  async startOrderProcessing(orderCreatedEvent) {
    const sagaId = `order-saga-${orderCreatedEvent.orderId}`;
    
    try {
      this.logger.info('Starting order processing saga', { 
        sagaId,
        orderId: orderCreatedEvent.orderId
      });

      const saga = new SagaState(sagaId, 'ORDER_PROCESSING', orderCreatedEvent.orderId);
      
      // Step 1: Reserve inventory
      const reservationResult = await this.inventoryService.reserveStock({
        orderId: orderCreatedEvent.orderId,
        items: orderCreatedEvent.lineItems,
        sagaId
      });

      saga.addStep('INVENTORY_RESERVED', {
        reservationId: reservationResult.reservationId,
        items: orderCreatedEvent.lineItems
      });

      // Step 2: Process payment
      const paymentResult = await this.paymentService.authorizePayment({
        orderId: orderCreatedEvent.orderId,
        customerId: orderCreatedEvent.customerId,
        amount: orderCreatedEvent.totalAmount,
        sagaId
      });

      saga.addStep('PAYMENT_AUTHORIZED', {
        paymentId: paymentResult.paymentId,
        amount: orderCreatedEvent.totalAmount
      });

      // Step 3: Confirm order
      await this.orderService.confirmOrder(new ConfirmOrderCommand(orderCreatedEvent.orderId));

      saga.addStep('ORDER_CONFIRMED', {
        orderId: orderCreatedEvent.orderId
      });

      saga.markAsCompleted();
      await this.sagaRepository.save(saga);

      this.logger.info('Order processing saga completed successfully', { 
        sagaId,
        orderId: orderCreatedEvent.orderId
      });

    } catch (error) {
      this.logger.error('Order processing saga failed', {
        sagaId,
        orderId: orderCreatedEvent.orderId,
        error: error.message
      });

      await this.compensateOrderProcessing(sagaId, error);
    }
  }

  async compensateOrderProcessing(sagaId, originalError) {
    try {
      const saga = await this.sagaRepository.findById(sagaId);
      if (!saga) {
        this.logger.error('Saga not found for compensation', { sagaId });
        return;
      }

      const steps = saga.getSteps().reverse(); // Compensate in reverse order

      for (const step of steps) {
        try {
          switch (step.action) {
            case 'ORDER_CONFIRMED':
              await this.orderService.cancelOrder(
                new CancelOrderCommand(step.data.orderId, 'Saga compensation')
              );
              break;

            case 'PAYMENT_AUTHORIZED':
              await this.paymentService.refundPayment(step.data.paymentId);
              break;

            case 'INVENTORY_RESERVED':
              await this.inventoryService.releaseReservation(step.data.reservationId);
              break;
          }

          this.logger.info('Compensation step completed', {
            sagaId,
            action: step.action
          });

        } catch (compensationError) {
          this.logger.error('Compensation step failed', {
            sagaId,
            action: step.action,
            error: compensationError.message
          });
          
          // Mark for manual intervention
          saga.markAsFailedCompensation(step.action, compensationError.message);
        }
      }

      saga.markAsFailed(originalError.message);
      await this.sagaRepository.save(saga);

    } catch (error) {
      this.logger.error('Saga compensation failed', {
        sagaId,
        error: error.message
      });
    }
  }
}

// Saga State Management
class SagaState {
  constructor(sagaId, sagaType, orderId) {
    this.sagaId = sagaId;
    this.sagaType = sagaType;
    this.orderId = orderId;
    this.status = 'IN_PROGRESS';
    this.steps = [];
    this.startedAt = new Date();
    this.completedAt = null;
    this.failedAt = null;
    this.errorMessage = null;
    this.compensationFailures = [];
  }

  addStep(action, data) {
    this.steps.push({
      action,
      data,
      completedAt: new Date()
    });
  }

  getSteps() {
    return [...this.steps];
  }

  markAsCompleted() {
    this.status = 'COMPLETED';
    this.completedAt = new Date();
  }

  markAsFailed(errorMessage) {
    this.status = 'FAILED';
    this.failedAt = new Date();
    this.errorMessage = errorMessage;
  }

  markAsFailedCompensation(action, errorMessage) {
    this.compensationFailures.push({
      action,
      errorMessage,
      failedAt: new Date()
    });
  }

  isCompleted() {
    return this.status === 'COMPLETED';
  }

  isFailed() {
    return this.status === 'FAILED';
  }

  needsManualIntervention() {
    return this.compensationFailures.length > 0;
  }
}

// Event Handlers
class OrderEventHandler {
  constructor(orderProcessingSaga) {
    this.orderProcessingSaga = orderProcessingSaga;
  }

  async handleOrderCreated(event) {
    await this.orderProcessingSaga.startOrderProcessing(event);
  }

  async handleInventoryReservationFailed(event) {
    // Handle inventory reservation failure
    // Could trigger alternative flows or notifications
  }

  async handlePaymentFailed(event) {
    // Handle payment failure
    // Trigger compensation or customer notification
  }
}

module.exports = {
  OrderApplicationService,
  OrderProcessingSaga,
  OrderEventHandler,
  SagaState,
  CreateOrderCommand,
  ConfirmOrderCommand,
  ShipOrderCommand,
  CancelOrderCommand
};