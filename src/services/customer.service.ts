/** @format */

import Customer from "../models/customer.model.js";
import User from "../models/user.model.js";
import { NotFoundException } from "../errors/not-found-exception.error.js";
import { HttpStatus } from "../config/http.config.js";
import { ErrorCode } from "../enums/error-code.enum.js";
import { transaction } from "../util/transaction.util.js";
import { BadRequestException } from "../errors/bad-request-exception.error.js";
import { ClientSession } from "mongoose";

export class CustomerService {
  private getCustomerByUserId = async (
    userId: string,
    session?: ClientSession,
  ) => {
    const customerQuery = Customer.findOne({ userId });

    if (session) {
      customerQuery.session(session);
    }

    const customer = await customerQuery.populate("userId").populate("addressId");

    if (!customer) {
      throw new NotFoundException(
        "Customer not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    return customer;
  };

  private updateCustomerProfileRecord = async (
    session: ClientSession,
    customerId: string,
    userId: string,
    body: {
      profileImageUrl?: string;
      firstName?: string;
      lastName?: string;
      email?: string;
      phoneNumber?: string;
    },
  ) => {
    const { profileImageUrl, firstName, lastName, email, phoneNumber } = body;

    const customer = await Customer.findOneAndUpdate(
      { _id: customerId, userId },
      {
        $set: {
          ...(profileImageUrl !== undefined && { profileImageUrl }),
        },
      },
      { new: true },
    ).session(session);

    const user = await User.findOneAndUpdate(
      { _id: userId },
      {
        $set: {
          ...(firstName !== undefined && { firstName }),
          ...(lastName !== undefined && { lastName }),
          ...(email !== undefined && { email }),
          ...(phoneNumber !== undefined && { phoneNumber }),
        },
      },
      { new: true },
    ).session(session);

    if (!customer && !user) {
      throw new NotFoundException(
        "Customer profile not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    return { ...{ user }, ...{ customer } };
  };

  private deleteCustomerProfileRecord = async (
    session: ClientSession,
    customerId: string,
    userId: string,
  ) => {
    const customer = await Customer.findOne({
      _id: customerId,
      userId,
    }).session(session);

    if (!customer) {
      throw new NotFoundException(
        "Customer not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    const user = await User.findById(customer.userId).session(session);

    if (!user) {
      throw new NotFoundException(
        "User not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    await user.deleteOne({ session });
    await customer.deleteOne({ session });
  };

  getCurrentCustomerProfile = async (userId: string) => {
    if (!userId) {
      throw new BadRequestException(
        "User ID is required",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const customer = await this.getCustomerByUserId(userId);

    return { customer };
  };

  getCustomerProfile = async (customerId: string, userId: string) => {
    if (!customerId) {
      throw new BadRequestException(
        "Customer ID is required",
        HttpStatus.BAD_REQUEST,
        ErrorCode.VALIDATION_ERROR,
      );
    }

    const customer = await Customer.findOne({ _id: customerId, userId })
      .populate("userId")
      .populate("addressId");

    if (!customer) {
      throw new NotFoundException(
        "Customer not found",
        HttpStatus.NOT_FOUND,
        ErrorCode.RESOURCE_NOT_FOUND,
      );
    }

    return { customer };
  };

  updateCustomerProfile = transaction.use(
    async (
      session: ClientSession,
      customerId: string,
      userId: string,
      body: {
        profileImageUrl?: string;
        firstName?: string;
        lastName?: string;
        email?: string;
        phoneNumber?: string;
      },
    ) => {
      if (!customerId) {
        throw new BadRequestException(
          "Customer ID is required",
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
        );
      }

      return await this.updateCustomerProfileRecord(
        session,
        customerId,
        userId,
        body,
      );
    },
  );

  updateCurrentCustomerProfile = transaction.use(
    async (
      session: ClientSession,
      userId: string,
      body: {
        profileImageUrl?: string;
        firstName?: string;
        lastName?: string;
        email?: string;
        phoneNumber?: string;
      },
    ) => {
      if (!userId) {
        throw new BadRequestException(
          "User ID is required",
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
        );
      }

      const currentCustomer = await Customer.findOne({ userId })
        .select("_id")
        .session(session);

      if (!currentCustomer) {
        throw new NotFoundException(
          "Customer not found",
          HttpStatus.NOT_FOUND,
          ErrorCode.RESOURCE_NOT_FOUND,
        );
      }

      return await this.updateCustomerProfileRecord(
        session,
        currentCustomer._id.toString(),
        userId,
        body,
      );
    },
  );

  deleteCustomerProfile = transaction.use(
    async (session: ClientSession, customerId: string, userId: string) => {
      if (!customerId) {
        throw new BadRequestException(
          "Customer ID is required",
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
        );
      }

      await this.deleteCustomerProfileRecord(session, customerId, userId);
    },
  );

  deleteCurrentCustomerProfile = transaction.use(
    async (session: ClientSession, userId: string) => {
      if (!userId) {
        throw new BadRequestException(
          "User ID is required",
          HttpStatus.BAD_REQUEST,
          ErrorCode.VALIDATION_ERROR,
        );
      }

      const currentCustomer = await Customer.findOne({ userId })
        .select("_id")
        .session(session);

      if (!currentCustomer) {
        throw new NotFoundException(
          "Customer not found",
          HttpStatus.NOT_FOUND,
          ErrorCode.RESOURCE_NOT_FOUND,
        );
      }

      await this.deleteCustomerProfileRecord(
        session,
        currentCustomer._id.toString(),
        userId,
      );
    },
  );
}
